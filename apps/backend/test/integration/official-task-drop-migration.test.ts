import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/task-drops-email', () => ({
  sendOfficialTaskDropAnnouncement: vi.fn().mockResolvedValue(undefined),
}));

import * as schema from '../../src/db/schema';
import { announceOfficialTaskDrop } from '../../src/services/task-drop-announcements';
import { enforceTaskDropSubscribeRateLimit } from '../../src/services/task-drop-subscribe-rate-limit';
import { sendOfficialTaskDropAnnouncement } from '../../src/services/task-drops-email';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const schemaName = `official_drop_migration_${randomUUID().replaceAll('-', '')}`;
const migration = readFileSync(
  new URL('../../drizzle/migrations/0026_official_task_drop_subscriptions.sql', import.meta.url),
  'utf8'
);

describeWithDatabase('official Task Drop migration against PostgreSQL', () => {
  const sql = postgres(databaseUrl!, { max: 1 });
  const database = drizzle(sql, { schema });

  beforeAll(async () => {
    await sql.unsafe(`CREATE SCHEMA "${schemaName}"`);
    await sql.unsafe(`SET search_path TO "${schemaName}"`);
    await sql.unsafe(`
      CREATE TABLE task_drops (
        id text PRIMARY KEY,
        owner_address text NOT NULL,
        name text NOT NULL,
        description text,
        created_at timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE task_drop_subscriptions (
        id text PRIMARY KEY,
        task_drop_id text REFERENCES task_drops(id),
        email text NOT NULL,
        wallet_address text,
        agent_address text,
        source text NOT NULL DEFAULT 'first_run_panel',
        status text NOT NULL DEFAULT 'active',
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now(),
        unsubscribed_at timestamp
      );
      CREATE TABLE tasks (
        id text PRIMARY KEY,
        task_drop_id text REFERENCES task_drops(id),
        description text NOT NULL,
        mode text NOT NULL,
        reward numeric(78, 0) NOT NULL,
        task_visibility text NOT NULL DEFAULT 'public'
      );
      INSERT INTO task_drops (id, owner_address, name)
      VALUES ('drop-1', '0x1111111111111111111111111111111111111111', 'Drop One');
      INSERT INTO task_drop_subscriptions (id, task_drop_id, email)
      VALUES
        ('legacy-sub', NULL, 'legacy@example.com'),
        ('drop-sub', 'drop-1', 'drop@example.com');
    `);
    await sql.unsafe(migration);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function enforceFromIndependentConnection(input: { clientAddress: string; email: string }) {
    const isolatedSql = postgres(databaseUrl!, { max: 1 });
    try {
      await isolatedSql.unsafe(`SET search_path TO "${schemaName}"`);
      const isolatedDatabase = drizzle(isolatedSql, { schema });
      await enforceTaskDropSubscribeRateLimit({ db: isolatedDatabase, ...input });
    } finally {
      await isolatedSql.end();
    }
  }

  afterAll(async () => {
    await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await sql.end();
  });

  it('backfills exact subscriptions and keeps legacy null-drop rows inert', async () => {
    const rows = await sql<{ id: string; scope: string }[]>`
      SELECT id, subscription_scope AS scope
      FROM task_drop_subscriptions
      ORDER BY id
    `;

    expect(rows).toEqual([
      { id: 'drop-sub', scope: 'drop' },
      { id: 'legacy-sub', scope: 'legacy' },
    ]);
  });

  it('rejects invalid scope/drop combinations', async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe(`
          INSERT INTO task_drop_subscriptions
            (id, task_drop_id, email, subscription_scope)
          VALUES ('invalid-drop', NULL, 'invalid@example.com', 'drop')
        `);
      })
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('enforces case-insensitive uniqueness for official subscriptions', async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe(`
          INSERT INTO task_drop_subscriptions
            (id, task_drop_id, email, subscription_scope)
          VALUES
            ('official-1', NULL, 'Case@Example.com', 'official'),
            ('official-2', NULL, 'case@example.com', 'official')
        `);
      })
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('creates announcement freeze and delivery snapshot storage', async () => {
    const [announcedAt, deliveryTable] = await Promise.all([
      sql<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM information_schema.columns
        WHERE table_schema = ${schemaName}
          AND table_name = 'task_drops'
          AND column_name = 'announced_at'
      `,
      sql<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM information_schema.tables
        WHERE table_schema = ${schemaName}
          AND table_name = 'task_drop_announcement_deliveries'
      `,
    ]);

    expect(announcedAt[0]?.count).toBe(1);
    expect(deliveryTable[0]?.count).toBe(1);
  });

  it('atomically limits subscription attempts across independent database clients', async () => {
    const clientResults = await Promise.allSettled(
      Array.from({ length: 11 }, (_, index) =>
        enforceFromIndependentConnection({
          clientAddress: '203.0.113.50',
          email: `client-limit-${index}@example.com`,
        })
      )
    );

    const clientErrors = clientResults
      .filter((result) => result.status === 'rejected')
      .map((result) => String(result.reason?.stack ?? result.reason));
    expect(
      clientResults.filter((result) => result.status === 'fulfilled'),
      clientErrors.join('\n')
    ).toHaveLength(10);
    expect(clientResults.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(clientResults.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'TOO_MANY_REQUESTS' },
    });

    const emailResults = await Promise.allSettled(
      Array.from({ length: 4 }, (_, index) =>
        enforceFromIndependentConnection({
          clientAddress: `203.0.113.${60 + index}`,
          email: 'shared-recipient@example.com',
        })
      )
    );

    expect(emailResults.filter((result) => result.status === 'fulfilled')).toHaveLength(3);
    expect(emailResults.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(emailResults.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'TOO_MANY_REQUESTS' },
    });
  });

  it('recovers an abandoned task creation reservation before announcing', async () => {
    await sql.unsafe(`
      INSERT INTO task_drops (id, owner_address, name)
      VALUES ('drop-stale-reservation', '0x4444444444444444444444444444444444444444', 'Recovered');
      INSERT INTO task_drop_task_reservations (reservation_id, task_drop_id, created_at)
      VALUES ('reservation-stale', 'drop-stale-reservation', now() - interval '31 minutes');
    `);

    try {
      const result = await announceOfficialTaskDrop({
        db: database,
        taskDropId: 'drop-stale-reservation',
      });
      const reservations = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM task_drop_task_reservations
        WHERE task_drop_id = 'drop-stale-reservation'
      `;

      expect(result).toMatchObject({ alreadyAnnounced: false, total: 0 });
      expect(reservations[0]?.count).toBe(0);
    } finally {
      await sql.unsafe(`
        DELETE FROM task_drop_announcement_deliveries
        WHERE task_drop_id = 'drop-stale-reservation';
        DELETE FROM task_drop_task_reservations
        WHERE task_drop_id = 'drop-stale-reservation';
        DELETE FROM task_drops
        WHERE id = 'drop-stale-reservation';
      `);
    }
  });

  it('snapshots fresh consent correctly in a non-UTC database session', async () => {
    await sql.unsafe(`SET TIME ZONE 'Australia/Sydney'`);
    try {
      await sql.unsafe(`
        INSERT INTO task_drops (id, owner_address, name)
        VALUES ('drop-non-utc-consent', '0x3333333333333333333333333333333333333333', 'Non-UTC');
        INSERT INTO task_drop_subscriptions
          (id, task_drop_id, email, subscription_scope, status)
        VALUES
          ('sub-non-utc-consent', NULL, 'non-utc@example.com', 'official', 'active');
      `);

      const result = await announceOfficialTaskDrop({
        db: database,
        taskDropId: 'drop-non-utc-consent',
      });

      expect(sendOfficialTaskDropAnnouncement).toHaveBeenCalledOnce();
      expect(result).toMatchObject({ pending: 0, sent: 1, total: 1 });
    } finally {
      await sql.unsafe(`
        DELETE FROM task_drop_announcement_deliveries
        WHERE task_drop_id = 'drop-non-utc-consent';
        DELETE FROM task_drop_subscriptions
        WHERE id = 'sub-non-utc-consent';
        DELETE FROM task_drops
        WHERE id = 'drop-non-utc-consent';
        SET TIME ZONE 'UTC';
      `);
    }
  });

  it('skips a subscriber who unsubscribes after the batch is loaded', async () => {
    await sql.unsafe(`
      INSERT INTO task_drops (id, owner_address, name)
      VALUES ('drop-concurrent-unsubscribe', '0x2222222222222222222222222222222222222222', 'Concurrent');
      INSERT INTO task_drop_subscriptions
        (id, task_drop_id, email, subscription_scope, status, consented_at)
      VALUES
        ('sub-concurrent-a', NULL, 'concurrent-a@example.com', 'official', 'active', now() - interval '1 day'),
        ('sub-concurrent-b', NULL, 'concurrent-b@example.com', 'official', 'active', now() - interval '1 day');
    `);

    let firstSubscriptionId = '';
    let releaseFirstSend!: () => void;
    let markFirstSendStarted!: () => void;
    const firstSendStarted = new Promise<void>((resolve) => {
      markFirstSendStarted = resolve;
    });
    const firstSendGate = new Promise<void>((resolve) => {
      releaseFirstSend = resolve;
    });
    vi.mocked(sendOfficialTaskDropAnnouncement).mockImplementationOnce(async ({ subscription }) => {
      firstSubscriptionId = subscription.id;
      markFirstSendStarted();
      await firstSendGate;
    });

    const announcement = announceOfficialTaskDrop({
      db: database,
      taskDropId: 'drop-concurrent-unsubscribe',
    });
    await firstSendStarted;

    const unsubscribedId =
      firstSubscriptionId === 'sub-concurrent-a' ? 'sub-concurrent-b' : 'sub-concurrent-a';
    await sql`
      UPDATE task_drop_subscriptions
      SET status = 'unsubscribed', unsubscribed_at = now(), updated_at = now()
      WHERE id = ${unsubscribedId}
    `;
    releaseFirstSend();

    const result = await announcement;

    expect(sendOfficialTaskDropAnnouncement).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ pending: 0, sent: 1, total: 2 });
  });
});

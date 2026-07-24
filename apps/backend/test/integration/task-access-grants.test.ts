import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { issueTaskAccessGrant, verifyTaskAccessGrant } from '../../src/lib/task-access-grants';
import { sha256Hex } from '../../src/lib/hash';
import { taskAccessGrants, tasks } from '../../src/db/schema';
import { createIsolatedMigratedDatabase } from '../helpers/integration-database';

const isolatedDatabase = createIsolatedMigratedDatabase('task_access_grants');
const describeWithDatabase = isolatedDatabase.isAvailable ? describe : describe.skip;
const { database } = isolatedDatabase;

let taskCounter = 0;

// Inserts a fresh task row and returns its id -- called from inside each `it()` (not a
// shared beforeAll), matching this repo's existing isolated-database test convention
// (see task-drops-directory.test.ts).
async function seedTask(): Promise<string> {
  taskCounter += 1;
  const id = `task-grant-${taskCounter}`;
  await database.insert(tasks).values({
    id,
    requester: '0xRequester000000000000000000000000000001',
    requesterPubkey: '',
    description: 'A private task',
    reward: '1000000',
    escrowTxHash: `0xhash${id}`,
    expiryTime: new Date(Date.now() + 86400000),
    status: 'open',
    tags: [],
    taskVisibility: 'private',
  });
  return id;
}

describeWithDatabase('task access grants (real DB, ADR-0030)', () => {
  beforeAll(() => isolatedDatabase.start());
  afterAll(() => isolatedDatabase.stop());

  it('issues a grant and verifies it back to the same taskId', async () => {
    const taskId = await seedTask();
    const { grant, expiresAt } = await issueTaskAccessGrant(database, taskId);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    const resolved = await verifyTaskAccessGrant(database, grant);
    expect(resolved).toEqual({ taskId });
  });

  it('stores only a hash of the token, never the raw token', async () => {
    const taskId = await seedTask();
    const { grant } = await issueTaskAccessGrant(database, taskId);
    const rows = await database.select().from(taskAccessGrants);
    expect(rows.some((row) => row.tokenHash === grant)).toBe(false);
  });

  it('a grant for one task does not unlock a different task', async () => {
    const taskIdA = await seedTask();
    const taskIdB = await seedTask();
    const { grant } = await issueTaskAccessGrant(database, taskIdA);

    const resolved = await verifyTaskAccessGrant(database, grant);
    expect(resolved?.taskId).toBe(taskIdA);
    expect(resolved?.taskId).not.toBe(taskIdB);
  });

  it('rejects an unknown token', async () => {
    await seedTask();
    expect(await verifyTaskAccessGrant(database, 'tmtpa_totally-made-up')).toBeNull();
  });

  it('rejects an expired grant', async () => {
    const taskId = await seedTask();
    // Issuing "as of" the Unix epoch puts expiresAt (epoch + 24h) far in the past
    // relative to the real clock verifyTaskAccessGrant checks against.
    const { grant } = await issueTaskAccessGrant(database, taskId, new Date(0));
    expect(await verifyTaskAccessGrant(database, grant)).toBeNull();
  });

  it('rejects a revoked grant', async () => {
    const taskId = await seedTask();
    const { grant } = await issueTaskAccessGrant(database, taskId);
    await database
      .update(taskAccessGrants)
      .set({ revokedAt: new Date() })
      .where(eq(taskAccessGrants.tokenHash, sha256Hex(grant)));
    expect(await verifyTaskAccessGrant(database, grant)).toBeNull();
  });

  it('is not single-use -- the same grant verifies successfully more than once', async () => {
    const taskId = await seedTask();
    const { grant } = await issueTaskAccessGrant(database, taskId);
    expect(await verifyTaskAccessGrant(database, grant)).toEqual({ taskId });
    expect(await verifyTaskAccessGrant(database, grant)).toEqual({ taskId });
  });
});

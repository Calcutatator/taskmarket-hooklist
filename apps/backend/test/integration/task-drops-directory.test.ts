import { randomUUID } from 'node:crypto';
import express from 'express';
import { inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { createOpenApiExpressMiddleware } from 'trpc-to-openapi';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const { OFFICIAL_OWNER } = vi.hoisted(() => ({
  OFFICIAL_OWNER: '0x2222222222222222222222222222222222222222',
}));

vi.mock('../../src/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/env')>();

  return {
    ...actual,
    getServerConfig: vi.fn().mockReturnValue({
      NODE_ENV: 'test',
      OFFICIAL_TASK_DROP_OWNER_ADDRESSES: [OFFICIAL_OWNER],
    }),
  };
});

import { taskDrops, tasks } from '../../src/db/schema';
import { taskDropsRouter } from '../../src/routers/task-drops.router';
import { router } from '../../src/trpc';
import { createIsolatedMigratedDatabase } from '../helpers/integration-database';

const isolatedDatabase = createIsolatedMigratedDatabase('task_drops_directory');
const describeWithDatabase = isolatedDatabase.isAvailable ? describe : describe.skip;
const { database } = isolatedDatabase;
const taskIds: string[] = [];
const taskDropIds: string[] = [];

const directoryRouter = router({ taskDrops: taskDropsRouter });

function directoryApp() {
  const app = express();
  app.use(
    '/api',
    createOpenApiExpressMiddleware({
      router: directoryRouter,
      createContext: ({ req, res }) => ({
        db: database!,
        req,
        res,
        caller: undefined,
        idempotencyKey: undefined,
        taskAccessGrant: undefined,
      }),
    })
  );
  return app;
}

describeWithDatabase('Task Drop public directory', () => {
  beforeAll(async () => {
    await isolatedDatabase.start();
  });

  afterEach(async () => {
    if (taskIds.length > 0) {
      await database.delete(tasks).where(inArray(tasks.id, taskIds.splice(0)));
    }
    if (taskDropIds.length > 0) {
      await database.delete(taskDrops).where(inArray(taskDrops.id, taskDropIds.splice(0)));
    }
  });

  afterAll(async () => {
    await isolatedDatabase.stop();
  });

  it('serves official-first keyset pages and excludes unlisted-only drops', async () => {
    const suffix = randomUUID();
    const officialDropId = `official-${suffix}`;
    const communityDropId = `community-${suffix}`;
    const hiddenDropId = `hidden-${suffix}`;
    taskDropIds.push(officialDropId, communityDropId, hiddenDropId);

    await database.insert(taskDrops).values([
      { id: officialDropId, name: 'Official drop', ownerAddress: OFFICIAL_OWNER },
      {
        id: communityDropId,
        name: 'Newer community drop',
        ownerAddress: '0x1111111111111111111111111111111111111111',
      },
      {
        id: hiddenDropId,
        name: 'Hidden drop',
        ownerAddress: '0x3333333333333333333333333333333333333333',
      },
    ]);

    const taskValues = [
      {
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        description: 'Official public task',
        id: `official-task-${suffix}`,
        taskDropId: officialDropId,
        taskVisibility: 'public',
      },
      {
        createdAt: new Date('2026-07-03T00:00:00.000Z'),
        description: 'Newer community task',
        id: `community-task-${suffix}`,
        taskDropId: communityDropId,
        taskVisibility: 'public',
      },
      {
        createdAt: new Date('2026-07-04T00:00:00.000Z'),
        description: 'Unlisted task',
        id: `hidden-task-${suffix}`,
        taskDropId: hiddenDropId,
        taskVisibility: 'unlisted',
      },
    ] as const;
    taskIds.push(...taskValues.map((task) => task.id));

    await database.insert(tasks).values(
      taskValues.map((task) => ({
        ...task,
        escrowTxHash: `escrow-${task.id}`,
        expiryTime: new Date('2030-01-01T00:00:00.000Z'),
        mode: 'bounty' as const,
        requester: '0xrequester',
        requesterPubkey: 'requester-key',
        reward: '1000000',
        status: 'open' as const,
        tags: ['integration'],
      }))
    );

    const firstPage = await request(directoryApp())
      .get('/api/task-drops/directory')
      .query({ limit: 1 });

    expect(firstPage.status, JSON.stringify(firstPage.body)).toBe(200);
    expect(firstPage.body.items.map((item: { drop: { id: string } }) => item.drop.id)).toEqual([
      officialDropId,
    ]);
    expect(firstPage.body.nextCursor).toEqual(expect.any(String));

    const secondPage = await request(directoryApp())
      .get('/api/task-drops/directory')
      .query({ cursor: firstPage.body.nextCursor, limit: 1 });

    expect(secondPage.status, JSON.stringify(secondPage.body)).toBe(200);
    expect(secondPage.body.items.map((item: { drop: { id: string } }) => item.drop.id)).toEqual([
      communityDropId,
    ]);
    expect(secondPage.body.nextCursor).toBeNull();
  });

  it('does not skip drops whose latest tasks share a millisecond', async () => {
    const suffix = randomUUID();
    const newerDropId = `microsecond-newer-${suffix}`;
    const olderDropId = `microsecond-older-${suffix}`;
    const newerTaskId = `microsecond-newer-task-${suffix}`;
    const olderTaskId = `microsecond-older-task-${suffix}`;
    taskDropIds.push(newerDropId, olderDropId);
    taskIds.push(newerTaskId, olderTaskId);

    await database.insert(taskDrops).values([
      {
        id: newerDropId,
        name: 'Newer within the millisecond',
        ownerAddress: '0x1111111111111111111111111111111111111111',
      },
      {
        id: olderDropId,
        name: 'Older within the millisecond',
        ownerAddress: '0x3333333333333333333333333333333333333333',
      },
    ]);

    await database.insert(tasks).values(
      [
        { id: newerTaskId, taskDropId: newerDropId },
        { id: olderTaskId, taskDropId: olderDropId },
      ].map((task) => ({
        ...task,
        description: task.id,
        escrowTxHash: `escrow-${task.id}`,
        expiryTime: new Date('2030-01-01T00:00:00.000Z'),
        mode: 'bounty',
        requester: '0xrequester',
        requesterPubkey: 'requester-key',
        reward: '1000000',
        status: 'open',
        tags: ['integration'],
        taskVisibility: 'public',
      }))
    );
    await database.execute(
      sql`update ${tasks}
          set created_at = case
            when ${tasks.id} = ${newerTaskId} then '2026-07-03 00:00:00.000900'::timestamp
            else '2026-07-03 00:00:00.000800'::timestamp
          end
          where ${inArray(tasks.id, [newerTaskId, olderTaskId])}`
    );

    const firstPage = await request(directoryApp())
      .get('/api/task-drops/directory')
      .query({ limit: 1 });
    const secondPage = await request(directoryApp())
      .get('/api/task-drops/directory')
      .query({ cursor: firstPage.body.nextCursor, limit: 1 });

    expect(firstPage.status, JSON.stringify(firstPage.body)).toBe(200);
    expect(secondPage.status, JSON.stringify(secondPage.body)).toBe(200);
    expect(
      [
        ...firstPage.body.items.map((item: { drop: { id: string } }) => item.drop.id),
        ...secondPage.body.items.map((item: { drop: { id: string } }) => item.drop.id),
      ],
      JSON.stringify({ firstPage: firstPage.body, secondPage: secondPage.body })
    ).toEqual([newerDropId, olderDropId]);
  });

  it('does not count post-delivery tasks as available work', async () => {
    const suffix = randomUUID();
    const dropId = `pending-approval-${suffix}`;
    const taskId = `pending-approval-task-${suffix}`;
    taskDropIds.push(dropId);
    taskIds.push(taskId);

    await database.insert(taskDrops).values({
      id: dropId,
      name: 'Awaiting requester approval',
      ownerAddress: '0x1111111111111111111111111111111111111111',
    });
    await database.insert(tasks).values({
      createdAt: new Date('2026-07-03T00:00:00.000Z'),
      description: 'Delivered work awaiting requester approval',
      escrowTxHash: `escrow-${taskId}`,
      expiryTime: new Date('2026-07-01T00:00:00.000Z'),
      id: taskId,
      mode: 'claim',
      requester: '0xrequester',
      requesterPubkey: 'requester-key',
      reward: '1000000',
      status: 'pending_approval',
      tags: ['integration'],
      taskDropId: dropId,
      taskVisibility: 'public',
    });

    const response = await request(directoryApp()).get('/api/task-drops/directory');
    const item = response.body.items.find(
      (candidate: { drop: { id: string } }) => candidate.drop.id === dropId
    );

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(item).toMatchObject({
      availableTaskCount: 0,
      nextExpiryTime: null,
    });
  });
});

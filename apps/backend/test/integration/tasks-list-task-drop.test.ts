import { randomUUID } from 'node:crypto';
import express from 'express';
import { inArray } from 'drizzle-orm';
import request from 'supertest';
import { createOpenApiExpressMiddleware } from 'trpc-to-openapi';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/env')>();

  return {
    ...actual,
    getServerConfig: vi.fn().mockReturnValue({ NODE_ENV: 'test' }),
  };
});

import { taskDrops, tasks } from '../../src/db/schema';
import { tasksRouter } from '../../src/routers/tasks.router';
import { router } from '../../src/trpc';
import { createIsolatedMigratedDatabase } from '../helpers/integration-database';

const isolatedDatabase = createIsolatedMigratedDatabase('task_drop_filter');
const describeWithDatabase = isolatedDatabase.isAvailable ? describe : describe.skip;
const { database } = isolatedDatabase;
const taskIds: string[] = [];
const taskDropIds: string[] = [];

const tasksListRouter = router({ tasks: tasksRouter });

function tasksListApp() {
  const app = express();
  app.use(
    '/api',
    createOpenApiExpressMiddleware({
      router: tasksListRouter,
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

describeWithDatabase('task list Task Drop filter', () => {
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

  it('filters the REST task collection by exact drop, status, and discovery visibility', async () => {
    const suffix = randomUUID();
    const targetDropId = `drop_${suffix}`;
    const otherDropId = `drop_${randomUUID()}`;
    const matchingTaskId = `task-drop-match-${suffix}`;
    const otherDropTaskId = `task-drop-other-${suffix}`;
    const unlistedTaskId = `task-drop-unlisted-${suffix}`;
    taskDropIds.push(targetDropId, otherDropId);
    taskIds.push(matchingTaskId, otherDropTaskId, unlistedTaskId);

    await database.insert(taskDrops).values([
      { id: targetDropId, name: 'Target drop', ownerAddress: '0xowner' },
      { id: otherDropId, name: 'Other drop', ownerAddress: '0xowner' },
    ]);
    await database.insert(tasks).values([
      {
        description: 'Matching public task',
        escrowTxHash: `escrow-${matchingTaskId}`,
        expiryTime: new Date('2030-01-01T00:00:00.000Z'),
        id: matchingTaskId,
        mode: 'bounty',
        requester: '0xrequester',
        requesterPubkey: 'requester-key',
        reward: '1000000',
        status: 'completed',
        tags: ['integration'],
        taskDropId: targetDropId,
      },
      {
        description: 'Task in another drop',
        escrowTxHash: `escrow-${otherDropTaskId}`,
        expiryTime: new Date('2030-01-01T00:00:00.000Z'),
        id: otherDropTaskId,
        mode: 'bounty',
        requester: '0xrequester',
        requesterPubkey: 'requester-key',
        reward: '1000000',
        status: 'completed',
        tags: ['integration'],
        taskDropId: otherDropId,
      },
      {
        description: 'Unlisted task in target drop',
        escrowTxHash: `escrow-${unlistedTaskId}`,
        expiryTime: new Date('2030-01-01T00:00:00.000Z'),
        id: unlistedTaskId,
        mode: 'bounty',
        requester: '0xrequester',
        requesterPubkey: 'requester-key',
        reward: '1000000',
        status: 'completed',
        tags: ['integration'],
        taskDropId: targetDropId,
        taskVisibility: 'unlisted',
      },
    ]);

    const response = await request(tasksListApp())
      .get('/api/tasks')
      .query({ status: 'completed', taskDropId: `  ${targetDropId}  ` });

    expect(response.status).toBe(200);
    expect(response.body.tasks).toHaveLength(1);
    expect(response.body.tasks[0]).toMatchObject({
      id: matchingTaskId,
      status: 'completed',
      taskDropId: targetDropId,
      taskVisibility: 'public',
    });
  });
});

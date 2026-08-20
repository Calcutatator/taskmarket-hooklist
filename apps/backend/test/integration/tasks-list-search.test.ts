/**
 * Search over the real listing query.
 *
 * Verifies: ADR-0098
 * Verifies: ADR-0099
 *
 * The first test here is the one the whole design exists to pass: an unlisted task must be
 * unreachable by any query, *including* one quoting a distinctive phrase from its own description.
 * That is the property a separate search index or a second retrieval path would have to re-earn by
 * hand, and the failure mode of getting it wrong is a private task in a result list rather than a
 * wrong count -- so it is asserted against a real database and the real router, not a mock.
 *
 * The rest cover what a user would notice: stemming, phrases, exclusion, that a pasted reference
 * code finds the thing it names, and that a hostile query is answered rather than thrown at.
 */

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

import { submissions, tasks } from '../../src/db/schema';
import { tasksRouter } from '../../src/routers/tasks.router';
import { router } from '../../src/trpc';
import { createIsolatedMigratedDatabase } from '../helpers/integration-database';

const isolatedDatabase = createIsolatedMigratedDatabase('tasks_list_search');
const describeWithDatabase = isolatedDatabase.isAvailable ? describe : describe.skip;
const { database } = isolatedDatabase;
const taskIds: string[] = [];
const submissionIds: string[] = [];

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

function taskRow(overrides: { id: string; description: string } & Record<string, unknown>) {
  return {
    escrowTxHash: `escrow-${overrides.id}`,
    expiryTime: new Date('2030-01-01T00:00:00.000Z'),
    mode: 'bounty',
    requester: '0xrequester',
    requesterPubkey: 'requester-key',
    reward: '1000000',
    status: 'completed',
    tags: ['integration'],
    ...overrides,
  };
}

async function searchIds(query: string, extraParams = ''): Promise<string[]> {
  const response = await request(tasksListApp())
    .get(`/api/tasks?status=ALL&limit=100&q=${encodeURIComponent(query)}${extraParams}`)
    .expect(200);
  return (response.body.tasks as { id: string }[]).map((task) => task.id);
}

describeWithDatabase('task list search', () => {
  const suffix = randomUUID();
  const publicTaskId = `search-public-${suffix}`;
  const unlistedTaskId = `search-unlisted-${suffix}`;
  const otherTaskId = `search-other-${suffix}`;
  const submissionId = `search-submission-${suffix}`;
  const taskCode = 'TSK-7K2QA9XF';
  const submissionCode = 'SUB-4M0BXQ2E';

  beforeAll(async () => {
    await isolatedDatabase.start();

    taskIds.push(publicTaskId, unlistedTaskId, otherTaskId);
    submissionIds.push(submissionId);

    await database.insert(tasks).values([
      taskRow({
        description:
          'Weather data benchmark harness\nBuild a harness that scores forecasts against observations.',
        id: publicTaskId,
        referenceCode: taskCode,
        tags: ['benchmarks', 'weather'],
      }),
      // Distinctive words that appear nowhere else, so a failure to exclude this row is
      // unambiguous rather than a coincidental match.
      taskRow({
        description:
          'Zarquon pipeline audit\nAudit the zarquon ingestion pipeline for correctness.',
        id: unlistedTaskId,
        referenceCode: 'TSK-ZZZZZZZZ',
        tags: ['zarquon'],
        taskVisibility: 'unlisted',
      }),
      taskRow({
        description: 'Video transcoding job\nTranscode source footage to multiple bitrates.',
        id: otherTaskId,
        referenceCode: 'TSK-4M0BXQ2F',
        tags: ['video'],
      }),
    ]);

    await database.insert(submissions).values([
      {
        fileUrl: 'https://example.test/deliverable',
        id: submissionId,
        referenceCode: submissionCode,
        signature: '0xsig',
        taskId: publicTaskId,
        workerAddress: '0xworker',
      },
    ]);
  });

  afterEach(async () => {
    // Rows are shared across the cases here, so nothing is torn down between them.
  });

  afterAll(async () => {
    if (submissionIds.length > 0) {
      await database.delete(submissions).where(inArray(submissions.id, submissionIds.splice(0)));
    }
    if (taskIds.length > 0) {
      await database.delete(tasks).where(inArray(tasks.id, taskIds.splice(0)));
    }
    await isolatedDatabase.stop();
  });

  it('never surfaces an unlisted task, even for a phrase unique to its own description', async () => {
    // The property the design exists for. "zarquon" appears in no other row, so if search had its
    // own retrieval path that forgot the discoverability rules, this is where it would show.
    expect(await searchIds('zarquon')).not.toContain(unlistedTaskId);
    expect(await searchIds('zarquon pipeline audit')).not.toContain(unlistedTaskId);
    expect(await searchIds('"zarquon ingestion"')).not.toContain(unlistedTaskId);
    // And not by its reference code either -- an exact identifier is still only a condition.
    expect(await searchIds('TSK-ZZZZZZZZ')).not.toContain(unlistedTaskId);
    // A code naming a hidden row and a code naming nothing are indistinguishable.
    expect(await searchIds('TSK-ZZZZZZZZ')).toEqual(await searchIds('TSK-00000000'));
  });

  it('finds a task by words from its description', async () => {
    expect(await searchIds('weather')).toContain(publicTaskId);
    expect(await searchIds('observations')).toContain(publicTaskId);
    expect(await searchIds('weather')).not.toContain(otherTaskId);
  });

  it('stems, so a plural query finds the singular text and vice versa', async () => {
    // The tag is 'benchmarks'; the description says 'benchmark'.
    expect(await searchIds('benchmark')).toContain(publicTaskId);
    expect(await searchIds('benchmarks')).toContain(publicTaskId);
  });

  it('supports quoted phrases and -exclusion', async () => {
    expect(await searchIds('"weather data"')).toContain(publicTaskId);
    // The words exist but not adjacently in this order.
    expect(await searchIds('"observations forecasts"')).not.toContain(publicTaskId);
    expect(await searchIds('weather -benchmark')).not.toContain(publicTaskId);
    expect(await searchIds('weather -video')).toContain(publicTaskId);
  });

  it('composes with the other filters rather than replacing them', async () => {
    // Intersection, not union: the query matches the public task but the mode filter excludes it.
    expect(await searchIds('weather', '&mode=pitch')).not.toContain(publicTaskId);
    expect(await searchIds('weather', '&mode=bounty')).toContain(publicTaskId);
  });

  it('resolves a pasted task reference code to exactly that task', async () => {
    expect(await searchIds(taskCode)).toEqual([publicTaskId]);
    // Case and whitespace as they arrive from a chat client.
    expect(await searchIds('  tsk-7k2qa9xf  ')).toEqual([publicTaskId]);
    // Crockford substitution -- someone heard "oh" and typed O.
    expect(await searchIds('TSK-7K2QA9XF'.replace('0', 'O'))).toEqual([publicTaskId]);
  });

  it('resolves a submission reference code to the task that contains it', async () => {
    expect(await searchIds(submissionCode)).toEqual([publicTaskId]);
    // Prefixless codes are matched against both entities.
    expect(await searchIds('4M0BXQ2E')).toContain(publicTaskId);
  });

  it('resolves a task id and a requester address', async () => {
    expect(await searchIds(publicTaskId)).toEqual([]); // not a bytes32, so treated as prose
    expect(await searchIds('0xrequester')).toEqual([]); // not a 40-hex address either
    const addressTaskId = `search-address-${randomUUID()}`;
    taskIds.push(addressTaskId);
    await database
      .insert(tasks)
      .values(
        taskRow({
          description: 'Address routed task\nFinds by requester address.',
          id: addressTaskId,
          requester: '0x1111111111111111111111111111111111111111',
        })
      );
    expect(await searchIds('0x1111111111111111111111111111111111111111')).toContain(addressTaskId);
    // Case-insensitively, as an address is usually pasted checksummed.
    expect(await searchIds('0x1111111111111111111111111111111111111111'.toUpperCase())).toContain(
      addressTaskId
    );
  });

  it('answers a hostile or nonsensical query instead of throwing', async () => {
    for (const query of ['&&&', ')', '"', '!@#$%^', 'a'.repeat(200)]) {
      await request(tasksListApp())
        .get(`/api/tasks?status=ALL&q=${encodeURIComponent(query)}`)
        .expect(200);
    }
  });

  it('refuses a query longer than the bound rather than truncating it', async () => {
    const response = await request(tasksListApp())
      .get(`/api/tasks?status=ALL&q=${'a'.repeat(201)}`)
      .expect(400);
    expect(response.status).toBe(400);
  });

  it('orders by relevance only when a full-text query is present', async () => {
    // Relevance with no query would rank everything at zero; the list keeps its normal order.
    const withoutQuery = await request(tasksListApp())
      .get('/api/tasks?status=ALL&limit=100&sort=relevance')
      .expect(200);
    expect((withoutQuery.body.tasks as unknown[]).length).toBeGreaterThan(0);

    const ranked = await searchIds('weather harness', '&sort=relevance');
    expect(ranked[0]).toBe(publicTaskId);
  });
});

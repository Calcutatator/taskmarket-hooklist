import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { agents, bids, claims, proofs, proposals, submissions, tasks } from '../../src/db/schema';
import { marketRouter } from '../../src/routers/market.router';
import { createIsolatedMigratedDatabase } from '../helpers/integration-database';
import { createMockCtx } from '../unit/helpers';

const isolatedDatabase = createIsolatedMigratedDatabase('market_stats');
const describeWithDatabase = isolatedDatabase.isAvailable ? describe : describe.skip;
const { database } = isolatedDatabase;

const REQUESTER = '0x1000000000000000000000000000000000000001';
const OLD_REQUESTER = '0x1000000000000000000000000000000000000002';
const UNLISTED_REQUESTER = '0x1000000000000000000000000000000000000003';
const WORKERS = [
  '0x2000000000000000000000000000000000000001',
  '0x2000000000000000000000000000000000000002',
  '0x2000000000000000000000000000000000000003',
  '0x2000000000000000000000000000000000000004',
  '0x2000000000000000000000000000000000000005',
] as const;
const UNLISTED_WORKER = '0x2000000000000000000000000000000000000006';
const UNREGISTERED_WORKER = '0x3000000000000000000000000000000000000001';

const RECENT_TASK = 'market-stats-recent';
const OLD_TASK = 'market-stats-old';
const UNLISTED_TASK = 'market-stats-unlisted';

describeWithDatabase('market stats against PostgreSQL', () => {
  beforeAll(async () => {
    await isolatedDatabase.start();

    const recent = new Date(Date.now() - 60 * 60 * 1000);
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const expiryTime = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await database.insert(agents).values(
      [REQUESTER, OLD_REQUESTER, UNLISTED_REQUESTER, ...WORKERS, UNLISTED_WORKER].map(
        (address) => ({ address })
      )
    );
    await database.insert(tasks).values([
      {
        createdAt: recent,
        description: 'Recent public task',
        escrowTxHash: 'market-stats-recent-escrow',
        expiryTime,
        id: RECENT_TASK,
        requester: REQUESTER.toUpperCase(),
        requesterPubkey: 'requester-key',
        reward: '1000000',
        status: 'completed',
        tags: ['integration'],
      },
      {
        createdAt: old,
        description: 'Old public task',
        escrowTxHash: 'market-stats-old-escrow',
        expiryTime,
        id: OLD_TASK,
        requester: OLD_REQUESTER,
        requesterPubkey: 'requester-key',
        reward: '1000000',
        status: 'open',
        tags: ['integration'],
      },
      {
        createdAt: recent,
        description: 'Recent unlisted task',
        escrowTxHash: 'market-stats-unlisted-escrow',
        expiryTime,
        id: UNLISTED_TASK,
        requester: UNLISTED_REQUESTER,
        requesterPubkey: 'requester-key',
        reward: '1000000',
        status: 'open',
        tags: ['integration'],
        taskVisibility: 'unlisted',
      },
    ]);

    await Promise.all([
      database.insert(submissions).values([
        {
          fileUrl: 'https://example.com/submission',
          id: 'market-stats-submission',
          signature: '0xsignature',
          submittedAt: recent,
          taskId: RECENT_TASK,
          workerAddress: WORKERS[0],
        },
        {
          fileUrl: 'https://example.com/unregistered',
          id: 'market-stats-unregistered-submission',
          signature: '0xsignature',
          submittedAt: recent,
          taskId: RECENT_TASK,
          workerAddress: UNREGISTERED_WORKER,
        },
        {
          fileUrl: 'https://example.com/unlisted',
          id: 'market-stats-unlisted-submission',
          signature: '0xsignature',
          submittedAt: recent,
          taskId: UNLISTED_TASK,
          workerAddress: UNLISTED_WORKER,
        },
      ]),
      database.insert(proposals).values({
        id: 'market-stats-proposal',
        proposalText: 'Proposal',
        signature: '0xsignature',
        submittedAt: recent,
        taskId: RECENT_TASK,
        workerAddress: WORKERS[1],
      }),
      database.insert(proofs).values({
        id: 'market-stats-proof',
        proofData: 'proof',
        proofType: 'benchmark',
        signature: '0xsignature',
        submittedAt: recent,
        taskId: RECENT_TASK,
        workerAddress: WORKERS[2],
      }),
      database.insert(claims).values({
        claimedAt: recent,
        id: 'market-stats-claim',
        stakeAmount: '0',
        stakeTxHash: 'market-stats-claim-tx',
        taskId: RECENT_TASK,
        workerAddress: WORKERS[3],
      }),
      database.insert(bids).values([
        {
          createdAt: recent,
          id: 'market-stats-bid',
          price: '1000000',
          taskId: RECENT_TASK,
          workerAddress: WORKERS[4],
        },
        {
          createdAt: recent,
          id: 'market-stats-duplicate-bid',
          price: '900000',
          taskId: RECENT_TASK,
          workerAddress: REQUESTER,
        },
      ]),
    ]);
  });

  afterAll(async () => {
    await isolatedDatabase.stop();
  });

  it('counts each registered address once across recent requester and worker activity', async () => {
    const ctx = createMockCtx();
    ctx.db = database;

    const result = await marketRouter.createCaller(ctx).stats({});

    expect(result).toEqual({
      activeAgents7d: 6,
      activeWorkers7d: 7,
      openTasks: 1,
      registeredWorkers: 9,
    });
  });
});

import { describe, expect, it } from 'vitest';
import { createMockCtx, makeChain } from '../helpers';
import {
  type PaidTaskAction,
  validatePaidTaskAction,
} from '../../../src/services/task-action-preflight';

const REQUESTER = '0x0000000000000000000000000000000000000001';
const WORKER = '0x0000000000000000000000000000000000000002';
const NOW = new Date('2026-07-11T00:00:00.000Z');

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: '0xtask',
    requester: REQUESTER,
    requesterPubkey: '',
    description: 'Task',
    reward: '1000000',
    escrowTxHash: '0xtx',
    createdAt: new Date('2026-07-10T00:00:00.000Z'),
    expiryTime: new Date('2026-07-12T00:00:00.000Z'),
    status: 'open',
    tags: [],
    mode: 'bounty',
    stakeRequired: 0,
    stakeBps: 0,
    pitchDeadline: null,
    bidDeadline: null,
    maxPrice: null,
    auctionType: null,
    auctionStartPrice: null,
    auctionFloorPrice: null,
    metricDescription: null,
    metricTarget: null,
    claimedBy: null,
    claimedAt: null,
    platformFeeBps: 500,
    requesterAgentId: null,
    chainId: 8453,
    contractAddress: REQUESTER,
    cancelledAt: null,
    selfAward: false,
    hookContract: null,
    evaluator: null,
    evaluatorStake: null,
    evaluatorFeeBps: null,
    evaluationWindow: null,
    appealWindow: null,
    disputeResolver: null,
    appealDeadline: null,
    verdictType: null,
    verdictScore: null,
    verdictConfidence: null,
    verdictEvidenceHash: null,
    evaluatorDeadline: null,
    ...overrides,
  };
}

describe('paid task action preflight', () => {
  const allowedCases: Array<{
    action: PaidTaskAction;
    task: Record<string, unknown>;
    body: Record<string, unknown>;
    payer: string;
    followupRows?: unknown[][];
  }> = [
    {
      action: 'accept',
      task: task(),
      body: { worker: WORKER },
      payer: REQUESTER,
      followupRows: [[{ id: 'submission' }]],
    },
    {
      action: 'accept_submissions',
      task: task(),
      body: { winners: [{ worker: WORKER, submissionId: 'submission' }] },
      payer: REQUESTER,
      followupRows: [[{ id: 'submission', workerAddress: WORKER }]],
    },
    {
      action: 'appeal',
      task: task({
        status: 'appealing',
        claimedBy: WORKER,
        appealDeadline: new Date('2026-07-11T01:00:00.000Z'),
      }),
      body: {},
      payer: WORKER,
    },
    {
      action: 'auction_accept',
      task: task({
        mode: 'auction',
        auctionType: 'dutch',
        maxPrice: '1000000',
        auctionFloorPrice: '500000',
        bidDeadline: new Date('2026-07-11T01:00:00.000Z'),
      }),
      body: { minPrice: '500000' },
      payer: WORKER,
    },
    {
      action: 'bid',
      task: task({
        mode: 'auction',
        auctionType: 'reverse_english',
        maxPrice: '1000000',
        bidDeadline: new Date('2026-07-11T01:00:00.000Z'),
      }),
      body: { price: '750000' },
      payer: WORKER,
      followupRows: [[]],
    },
    {
      action: 'evaluate',
      task: task({ status: 'review', evaluator: WORKER, evaluatorFeeBps: 500 }),
      body: { awards: [{ amount: '950000' }] },
      payer: WORKER,
    },
    {
      action: 'evaluator_timeout',
      task: task({
        status: 'review',
        evaluator: WORKER,
        evaluatorDeadline: new Date('2026-07-10T23:00:00.000Z'),
      }),
      body: {},
      payer: REQUESTER,
    },
    {
      action: 'pitch',
      task: task({
        mode: 'pitch',
        pitchDeadline: new Date('2026-07-11T01:00:00.000Z'),
      }),
      body: { workerAddress: WORKER },
      payer: WORKER,
      followupRows: [[]],
    },
    {
      action: 'submit_proof',
      task: task({ mode: 'benchmark' }),
      body: { workerAddress: WORKER },
      payer: WORKER,
      followupRows: [[]],
    },
    {
      action: 'rate',
      task: task({ status: 'completed' }),
      body: { worker: WORKER, rating: 100 },
      payer: REQUESTER,
      followupRows: [[{ workerAddress: WORKER, rating: null }]],
    },
    {
      action: 'refund_expired',
      task: task({
        mode: 'claim',
        status: 'pending_approval',
        expiryTime: new Date('2026-07-10T00:00:00.000Z'),
      }),
      body: {},
      payer: REQUESTER,
    },
    {
      action: 'reject_submission',
      task: task(),
      body: { worker: WORKER },
      payer: REQUESTER,
      followupRows: [[{ id: 'submission' }]],
    },
    {
      action: 'resolve_dispute',
      task: task({ status: 'disputed', disputeResolver: WORKER, evaluatorFeeBps: 0 }),
      body: { awards: [{ amount: '1000000' }] },
      payer: WORKER,
    },
    {
      action: 'update',
      task: task(),
      body: { reward: '1500000' },
      payer: REQUESTER,
    },
  ];

  it.each(allowedCases)('allows an eligible $action request', async (testCase) => {
    const ctx = createMockCtx();
    ctx.db.select.mockReturnValueOnce(makeChain([testCase.task]));
    for (const rows of testCase.followupRows ?? []) {
      ctx.db.select.mockReturnValueOnce(makeChain(rows));
    }

    await expect(
      validatePaidTaskAction(
        ctx.db,
        testCase.action,
        { params: { taskId: '0xtask' }, body: { taskId: '0xtask', ...testCase.body } } as never,
        testCase.payer,
        NOW
      )
    ).resolves.toBeUndefined();
  });

  it('rejects the wrong payer before requester action settlement', async () => {
    const ctx = createMockCtx();
    ctx.db.select.mockReturnValueOnce(makeChain([task()]));

    await expect(
      validatePaidTaskAction(
        ctx.db,
        'cancel',
        { params: { taskId: '0xtask' }, body: { taskId: '0xtask' } } as never,
        WORKER,
        NOW
      )
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects cancellation when an active contest submission exists', async () => {
    const ctx = createMockCtx();
    ctx.db.select
      .mockReturnValueOnce(makeChain([task()]))
      .mockReturnValueOnce(makeChain([{ id: 'submission' }]));

    await expect(
      validatePaidTaskAction(
        ctx.db,
        'cancel',
        { params: { taskId: '0xtask' }, body: { taskId: '0xtask' } } as never,
        REQUESTER,
        NOW
      )
    ).rejects.toThrow('Active submissions exist');
  });

  it('rejects duplicate split-acceptance workers before payment settlement', async () => {
    const ctx = createMockCtx();
    ctx.db.select.mockReturnValueOnce(makeChain([task()]));

    await expect(
      validatePaidTaskAction(
        ctx.db,
        'accept_submissions',
        {
          params: { taskId: '0xtask' },
          body: {
            taskId: '0xtask',
            winners: [
              { worker: WORKER, submissionId: 'submission-a' },
              { worker: WORKER.toUpperCase(), submissionId: 'submission-b' },
            ],
          },
        } as never,
        REQUESTER,
        NOW
      )
    ).rejects.toThrow('Duplicate award worker');
  });

  it('rejects a non-recipient rating before payment settlement', async () => {
    const ctx = createMockCtx();
    ctx.db.select
      .mockReturnValueOnce(makeChain([task({ status: 'completed' })]))
      .mockReturnValueOnce(
        makeChain([{ workerAddress: '0x0000000000000000000000000000000000000003', rating: null }])
      );

    await expect(
      validatePaidTaskAction(
        ctx.db,
        'rate',
        {
          params: { taskId: '0xtask' },
          body: { taskId: '0xtask', worker: WORKER, rating: 100 },
        } as never,
        REQUESTER,
        NOW
      )
    ).rejects.toThrow('Worker is not an award recipient');
  });

  it('rejects an already-rated recipient before payment settlement', async () => {
    const ctx = createMockCtx();
    ctx.db.select
      .mockReturnValueOnce(makeChain([task({ status: 'completed' })]))
      .mockReturnValueOnce(makeChain([{ workerAddress: WORKER, rating: 90 }]));

    await expect(
      validatePaidTaskAction(
        ctx.db,
        'rate',
        {
          params: { taskId: '0xtask' },
          body: { taskId: '0xtask', worker: WORKER, rating: 80 },
        } as never,
        REQUESTER,
        NOW
      )
    ).rejects.toThrow('Award recipient is already rated');
  });

  it('allows requester cancellation when no active entry exists', async () => {
    const ctx = createMockCtx();
    ctx.db.select.mockReturnValueOnce(makeChain([task()])).mockReturnValueOnce(makeChain([]));

    await expect(
      validatePaidTaskAction(
        ctx.db,
        'cancel',
        { params: { taskId: '0xtask' }, body: { taskId: '0xtask' } } as never,
        REQUESTER,
        NOW
      )
    ).resolves.toBeUndefined();
  });

  it('rejects a proof after benchmark expiry', async () => {
    const ctx = createMockCtx();
    ctx.db.select.mockReturnValueOnce(
      makeChain([task({ mode: 'benchmark', expiryTime: new Date('2026-07-10T00:00:00Z') })])
    );

    await expect(
      validatePaidTaskAction(
        ctx.db,
        'submit_proof',
        {
          params: { taskId: '0xtask' },
          body: { taskId: '0xtask', workerAddress: WORKER },
        } as never,
        WORKER,
        NOW
      )
    ).rejects.toThrow('Task has expired');
  });

  it('allows accepting the claimer of a claim task', async () => {
    const ctx = createMockCtx();
    ctx.db.select
      .mockReturnValueOnce(
        makeChain([task({ mode: 'claim', status: 'pending_approval', claimedBy: WORKER })])
      )
      .mockReturnValueOnce(makeChain([{ id: 'submission' }]));

    await expect(
      validatePaidTaskAction(
        ctx.db,
        'accept',
        { params: { taskId: '0xtask' }, body: { taskId: '0xtask', worker: WORKER } } as never,
        REQUESTER,
        NOW
      )
    ).resolves.toBeUndefined();
  });

  it('rejects accepting an address that is not the claimed worker', async () => {
    const ctx = createMockCtx();
    ctx.db.select.mockReturnValueOnce(
      makeChain([task({ mode: 'claim', status: 'pending_approval', claimedBy: WORKER })])
    );

    await expect(
      validatePaidTaskAction(
        ctx.db,
        'accept',
        { params: { taskId: '0xtask' }, body: { taskId: '0xtask', worker: REQUESTER } } as never,
        REQUESTER,
        NOW
      )
    ).rejects.toThrow('Selected worker does not match the task worker');
  });

  it('rejects an auction reward decrease below a stored clock boundary', async () => {
    const ctx = createMockCtx();
    ctx.db.select
      .mockReturnValueOnce(
        makeChain([
          task({
            mode: 'auction',
            auctionType: 'dutch',
            auctionFloorPrice: '800000',
            maxPrice: '1000000',
          }),
        ])
      )
      .mockReturnValueOnce(makeChain([]));

    await expect(
      validatePaidTaskAction(
        ctx.db,
        'update',
        { params: { taskId: '0xtask' }, body: { taskId: '0xtask', reward: '700000' } } as never,
        REQUESTER,
        NOW
      )
    ).rejects.toThrow('auctionFloorPrice must be less than or equal to reward');
  });
});

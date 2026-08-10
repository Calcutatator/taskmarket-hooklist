// Verifies: ADR-0045
// Verifies: ADR-0055
import { describe, expect, it, vi } from 'vitest';
import { createIntentCtx } from '../helpers';

/**
 * A stand-in for the one piece of chain state this is about: `s.requesterNonce[requester]`.
 *
 * `createTask` reads and increments it in the same expression that derives the task id
 * (CoreFacet), so the id a creation gets is decided at mine time and not before. The fake
 * mirrors exactly that: only the chain call advances the counter, and the id a transaction
 * ends up with is the value the counter held when that call ran -- not when it was prepared.
 */
const chain = {
  arrivals: 0,
  nonce: 0,
  releaseBoth: () => {},
  bothArrived: Promise.resolve(),
};
chain.bothArrived = new Promise<void>((resolve) => {
  chain.releaseBoth = resolve;
});

const idForNonce = (nonce: number) => `0x${nonce.toString(16).padStart(64, '0')}`;
const hashForNonce = (nonce: number) => `0xfeed${nonce.toString(16).padStart(60, '0')}`;
const nonceForHash = (hash: string) => Number.parseInt(hash.slice(6), 16);

vi.mock('../../../src/services/contract', () => ({
  contractAssignEvaluator: vi.fn().mockResolvedValue('0xassignhash'),
  contractCancelTask: vi.fn(),
  contractGetDreamsBonusBps: vi.fn().mockResolvedValue(0),
  contractGetDreamsPerUsdc: vi.fn().mockResolvedValue(0n),
  contractGetDreamsWorkerSplitBps: vi.fn().mockResolvedValue(0),
  contractGetTaskHooks: vi.fn().mockResolvedValue([]),
  contractRefundExpired: vi.fn(),
  contractRejectSubmission: vi.fn(),
  contractUpdateTask: vi.fn(),

  /**
   * Holds both creations at the chain call until both have arrived.
   *
   * This is the interleaving the defect needs and nothing in the real system prevents:
   * ADR-0040's dispatcher says in as many words that concurrent transactions may be in
   * flight at different nonces and that throughput is not serialized, and no per-requester
   * lock exists anywhere on this path. Forcing it here makes the race deterministic rather
   * than inventing one that could not happen.
   */
  contractCreateTask: vi.fn(async () => {
    chain.arrivals += 1;
    if (chain.arrivals === 2) chain.releaseBoth();
    await chain.bothArrived;
    return hashForNonce(chain.nonce++);
  }),

  // The chain stating which id it assigned to this transaction, which is what the TaskCreated
  // log in the real receipt is. Keyed on the hash, so it can only answer for a transaction
  // that has already run -- unlike a nonce read, which any later transaction can invalidate.
  taskIdForTx: vi.fn(async (txHash: string) => idForNonce(nonceForHash(txHash))),

  MODE_MAP: { bounty: '0x00000001' },
  AUCTION_SUBTYPE_MAP: {},
}));

vi.mock('../../../src/services/task-notifications', () => ({
  notifyNewTask: vi.fn().mockResolvedValue({ sent: 0, failed: 0, total: 0 }),
}));

vi.mock('../../../src/services/task-drops-email', () => ({
  notifyTaskDropSubscribers: vi.fn().mockResolvedValue({ sent: 0, failed: 0, total: 0 }),
}));

vi.mock('../../../src/config/env', () => ({
  getServerConfig: vi.fn().mockReturnValue({
    CHAIN_ID: 84532,
    CONTRACT_ADDRESS: '0x0000000000000000000000000000000000000001',
    DEFAULT_PLATFORM_FEE_BPS: 500,
    NODE_ENV: 'test',
    OFFICIAL_TASK_DROP_OWNER_ADDRESSES: [],
  }),
}));

import { tasksRouter } from '../../../src/routers/tasks.router';
import { tasks } from '../../../src/db/schema';

const PAYER = '0x1111111111111111111111111111111111111111';

const baseTaskInput = {
  description: 'Test task',
  duration: 7,
  mode: 'bounty' as const,
  reward: '1000000',
  stakeBps: 0,
  stakeRequired: false,
  tags: ['test'],
};

/**
 * Two creations by one requester, whose nonce reads interleave.
 *
 * This is the second and worse consequence of predicting a task id, and it needs no
 * rebroadcast and no reconciler to reach -- two ordinary requests are enough. Both read nonce
 * N, both predict id(N), the chain assigns N and N+1. The later intent then persists the
 * *earlier* task's id, and `completeTasksCreate`'s `onConflictDoUpdate` -- which exists to
 * tolerate the chain-event indexer inserting the same row first -- dutifully overwrites the
 * first task's description, reward, tags, visibility and deadlines with the second one's.
 *
 * The requester paid for two tasks and owns one, which now describes work they did not ask
 * for at that price.
 */
describe('two concurrent creations by one requester', () => {
  it('gives each its own task row, with neither overwriting the other', async () => {
    const first = createIntentCtx(PAYER);
    const second = createIntentCtx(PAYER);
    const firstTasks = first.insertChain(tasks);
    const secondTasks = second.insertChain(tasks);

    const [firstResult, secondResult] = await Promise.all([
      tasksRouter.createCaller(first).create({ ...baseTaskInput, description: 'First task' }),
      tasksRouter.createCaller(second).create({ ...baseTaskInput, description: 'Second task' }),
    ]);

    // The response each caller was handed.
    expect(firstResult.taskId).not.toBe(secondResult.taskId);

    // And what was actually written, which is what the requester ends up owning. Asserted
    // separately because a response can be right while the persisted row is not -- the
    // prediction produced exactly that, two truthful-looking responses over one row.
    const firstWritten = firstTasks.values.mock.calls[0]![0] as { description: string; id: string };
    const secondWritten = secondTasks.values.mock.calls[0]![0] as {
      description: string;
      id: string;
    };
    expect(firstWritten.id).not.toBe(secondWritten.id);
    expect([firstWritten.description, secondWritten.description].sort()).toEqual([
      'First task',
      'Second task',
    ]);

    // Each row carries its own transaction, so the ids are the two the chain actually
    // assigned rather than one of them written twice.
    expect(new Set([firstResult.taskId, secondResult.taskId])).toEqual(
      new Set([idForNonce(0), idForNonce(1)])
    );
  });
});

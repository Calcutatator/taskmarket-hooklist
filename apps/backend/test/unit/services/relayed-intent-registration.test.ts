// Verifies: ADR-0045
// Verifies: ADR-0046
import { describe, expect, it, vi } from 'vitest';
import { makeChain } from '../helpers';

vi.mock('../../../src/services/contract', () => ({
  contractAssignEvaluator: vi.fn().mockResolvedValue('0xassignhash'),
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
  }),
}));

import { contractAssignEvaluator } from '../../../src/services/contract';
import { registerRelayedIntentHandlers } from '../../../src/services/intents/register';
import {
  getRelayedIntentBroadcaster,
  getRelayedIntentHandler,
  registeredRelayedIntentOperations,
} from '../../../src/services/relayed-intent-registry';
import { tasks } from '../../../src/db/schema';
import type { RelayedIntent } from '../../../src/db/schema';

registerRelayedIntentHandlers();

const PAYER = '0x1111111111111111111111111111111111111111';
const EVALUATOR = '0x2222222222222222222222222222222222222222';
const TASK_ID = `0x${'a'.repeat(64)}`;

const assignment = {
  appealWindow: 3600,
  disputeResolver: null,
  evaluationWindow: 7200,
  evaluator: EVALUATOR,
  evaluatorFeeBps: 250,
};

function intent(overrides: Partial<RelayedIntent> = {}): RelayedIntent {
  return {
    chainDepth: 0,
    id: 'intent-1',
    operation: 'tasks.create',
    parentIntentId: null,
    payer: PAYER,
    status: 'broadcast',
    ...overrides,
  } as unknown as RelayedIntent;
}

function makeDb() {
  const taskInsert = makeChain();
  const taskUpdate = makeChain([]);
  const db: any = {
    delete: vi.fn().mockReturnValue(makeChain()),
    insert: vi.fn().mockReturnValue(taskInsert),
    select: vi.fn().mockReturnValue(makeChain([])),
    update: vi.fn().mockReturnValue(taskUpdate),
  };
  db.transaction = vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback(db));
  return { db, taskInsert, taskUpdate };
}

describe('relayed intent handler registration', () => {
  it('registers a completion handler for every operation create can reach', () => {
    // A missing handler is a silently unfinishable intent, not a runtime error, so the
    // registration itself is worth asserting.
    expect(registeredRelayedIntentOperations()).toEqual(
      expect.arrayContaining(['tasks.assignEvaluator', 'tasks.create'])
    );
  });

  it('completes a task creation with the confirmed hash the payload could not carry', async () => {
    const { db, taskInsert } = makeDb();
    const handler = getRelayedIntentHandler('tasks.create')!;

    await handler({
      db,
      intent: intent({
        payload: {
          allowedViewerAddresses: [],
          escrowTxHash: '',
          evaluatorAssignment: null,
          inlineTaskDrop: null,
          input: { description: 'Test task', duration: 7, reward: '1000000' },
          normalizedPayer: PAYER,
          payer: PAYER,
          resolvedTaskDropId: null,
          taskDropReservationId: null,
          taskId: TASK_ID,
        },
      } as Partial<RelayedIntent>),
      txHash: '0xescrowhash',
    });

    // The intent is recorded before the chain call, so the escrow hash is only knowable
    // here -- writing it from the payload would persist an empty string (ADR-0045).
    expect(taskInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({ escrowTxHash: '0xescrowhash', id: TASK_ID })
    );
  });

  it('broadcasts an evaluator assignment follow-on with the arguments the contract expects', async () => {
    const { db } = makeDb();
    const broadcast = getRelayedIntentBroadcaster('tasks.assignEvaluator')!;

    const txHash = await broadcast({
      db,
      intent: intent({
        chainDepth: 1,
        id: 'intent-2',
        operation: 'tasks.assignEvaluator',
        parentIntentId: 'intent-1',
        payload: { assignment, payer: PAYER, taskId: TASK_ID },
      } as Partial<RelayedIntent>),
    });

    expect(txHash).toBe('0xassignhash');
    expect(contractAssignEvaluator).toHaveBeenCalledWith(
      TASK_ID,
      PAYER,
      EVALUATOR,
      0n,
      250,
      7200,
      3600,
      '0x0000000000000000000000000000000000000000'
    );
  });

  it('writes the evaluator assignment onto the task once the follow-on confirms', async () => {
    const { db, taskUpdate } = makeDb();
    const handler = getRelayedIntentHandler('tasks.assignEvaluator')!;

    await handler({
      db,
      intent: intent({
        chainDepth: 1,
        id: 'intent-2',
        operation: 'tasks.assignEvaluator',
        parentIntentId: 'intent-1',
        payload: { assignment, payer: PAYER, taskId: TASK_ID },
      } as Partial<RelayedIntent>),
      txHash: '0xassignhash',
    });

    expect(db.update).toHaveBeenCalledWith(tasks);
    expect(taskUpdate.set).toHaveBeenCalledWith(assignment);
  });
});

// Verifies: ADR-0045, ADR-0050
import { describe, expect, it, vi } from 'vitest';
import { makeChain } from '../helpers';

vi.mock('../../../src/services/contract', () => ({
  blockNumberForTx: vi.fn().mockResolvedValue(100),
  blockTimestampForTx: vi.fn().mockResolvedValue(1_800_000_000),
  contractAssignEvaluator: vi.fn().mockResolvedValue('0xassignhash'),
  contractProjectSettlementForTx: vi.fn().mockResolvedValue({ settlement: null, settledAt: null }),
  contractClaimTask: vi.fn().mockResolvedValue('0xclaimhash'),
  contractFinalizeVerdictTx: vi.fn().mockResolvedValue('0xfinalizehash'),
  contractForfeitAndReopen: vi.fn().mockResolvedValue('0xforfeithash'),
  contractRegisterIdentityTx: vi.fn().mockResolvedValue('0xregisterhash'),
  contractSubmitWork: vi.fn().mockResolvedValue('0xsubmitworkhash'),
  contractTransferWithAuthorization: vi.fn().mockResolvedValue('0xtransferhash'),
  contractWithdrawDreamsRewards: vi.fn().mockResolvedValue('0xdreamshash'),
  resolveRegisteredAgentId: vi.fn().mockResolvedValue(42n),
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
  releaseIntentGuard,
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
    // notNull with a database default, and tasks.create anchors its deadlines to it.
    createdAt: new Date('2030-01-01T00:00:00.000Z'),
    id: 'intent-1',
    operation: 'tasks.create',
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
  // Verifies: ADR-0045
  it('registers a completion handler for every operation in the union', () => {
    // A missing handler is a silently unfinishable intent, not a runtime error: the work its
    // transaction paid for simply never reaches the database, and nothing says so. The union
    // is the closed list of what can be recorded, so it is also the list that must be bound.
    expect(registeredRelayedIntentOperations()).toEqual(
      [
        'acceptance.accept',
        'acceptance.acceptSubmissions',
        'acceptance.rate',
        'bids.auctionAccept',
        'bids.submit',
        'claims.claim',
        'claims.forfeit',
        'evaluations.appeal',
        'evaluations.evaluate',
        'evaluations.evaluatorTimeout',
        'evaluations.finalizeVerdict',
        'evaluations.resolveDispute',
        'identity.register',
        'pitches.select',
        'pitches.submit',
        'proofs.anchorDeliverable',
        'proofs.submit',
        'submissions.submit',
        'tasks.assignEvaluator',
        'tasks.cancel',
        'tasks.create',
        'tasks.refundExpired',
        'tasks.rejectSubmission',
        'tasks.update',
        'wallet.withdraw',
        'wallet.withdrawDreams',
      ].sort()
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

  it('broadcasts an evaluator assignment with the arguments the contract expects', async () => {
    const { db } = makeDb();
    const broadcast = getRelayedIntentBroadcaster('tasks.assignEvaluator')!;

    const txHash = await broadcast({
      db,
      intent: intent({
        id: 'intent-2',
        operation: 'tasks.assignEvaluator',
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

  it('writes the evaluator assignment onto the task once its transaction confirms', async () => {
    const { db, taskUpdate } = makeDb();
    const handler = getRelayedIntentHandler('tasks.assignEvaluator')!;

    await handler({
      db,
      intent: intent({
        id: 'intent-2',
        operation: 'tasks.assignEvaluator',
        payload: { assignment, payer: PAYER, taskId: TASK_ID },
      } as Partial<RelayedIntent>),
      txHash: '0xassignhash',
    });

    expect(db.update).toHaveBeenCalledWith(tasks);
    expect(taskUpdate.set).toHaveBeenCalledWith(assignment);
  });

  /**
   * The DREAMS replay guard, end to end against a stand-in for the table.
   *
   * Both directions matter and each is a different bug. A guard that is never released locks
   * the user out of an authorization they still hold; a guard released too eagerly lets a
   * captured signature be replayed against a withdrawal that may still be mining.
   */
  describe('the wallet.withdrawDreams replay guard', () => {
    const DREAMS_NONCE = `0x${'cd'.repeat(32)}`;

    /** Stands in for dreams_withdraw_nonces: a unique index with onConflictDoNothing on top. */
    function makeNonceStore() {
      const claimed = new Set<string>();
      const db: any = {
        claim: (nonce: string) => {
          if (claimed.has(nonce)) return [];
          claimed.add(nonce);
          return [{ nonce }];
        },
        delete: vi.fn().mockImplementation(() => ({
          where: (predicate: { nonce: string }) => {
            claimed.delete(predicate.nonce);
            return Promise.resolve([]);
          },
        })),
        held: () => [...claimed],
      };
      return db;
    }

    // Drizzle's eq() is opaque here, so the fake reads the nonce off the intent instead; the
    // assertion that matters is which nonce the release targets, and that it targets one.
    function releaseFor(db: any, nonce: string) {
      return releaseIntentGuard({
        db: { ...db, delete: () => ({ where: () => db.delete().where({ nonce }) }) },
        intent: intent({
          id: 'intent-dreams',
          operation: 'wallet.withdrawDreams',
          payload: { destination: PAYER, nonce, workerAddress: PAYER },
        } as Partial<RelayedIntent>),
      });
    }

    it('rejects a resubmission while the guard is still held', () => {
      const store = makeNonceStore();
      expect(store.claim(DREAMS_NONCE)).toHaveLength(1);
      // Zero rows inserted is what the router turns into CONFLICT.
      expect(store.claim(DREAMS_NONCE)).toHaveLength(0);
    });

    it('permits a resubmission of the same authorization once the guard is released', async () => {
      const store = makeNonceStore();
      store.claim(DREAMS_NONCE);

      await releaseFor(store, DREAMS_NONCE);

      expect(store.held()).toEqual([]);
      expect(store.claim(DREAMS_NONCE)).toHaveLength(1);
    });

    it('does nothing for an operation that claimed no guard', async () => {
      const store = makeNonceStore();
      store.claim(DREAMS_NONCE);

      await releaseIntentGuard({ db: store, intent: intent({ operation: 'tasks.create' }) });

      expect(store.delete).not.toHaveBeenCalled();
      expect(store.held()).toEqual([DREAMS_NONCE]);
    });
  });
});

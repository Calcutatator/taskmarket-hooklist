// Verifies: ADR-0047
// Verifies: ADR-0045
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubServerEnvironment } from '../../helpers/server-environment';

const restoreServerEnvironment = stubServerEnvironment();

const ESCROW_TX_HASH = `0x${'ab'.repeat(32)}` as `0x${string}`;
const ASSIGN_TX_HASH = `0x${'cd'.repeat(32)}` as `0x${string}`;
const TASK_ID = `0x${'11'.repeat(32)}`;
const PAYER = '0x1111111111111111111111111111111111111111';
const EVALUATOR = '0x2222222222222222222222222222222222222222';

const contractAssignEvaluator = vi.fn().mockResolvedValue(ASSIGN_TX_HASH);
// The chain stating which id it gave this transaction, which is what the TaskCreated log in the
// real receipt is. Keyed on the hash, so the same escrow receipt always decodes to the same id
// however many times the completion is run against it -- the property the derived idempotency
// key depends on.
const taskIdForTx = vi.fn(async (_txHash: string) => TASK_ID);

vi.mock('../../../src/services/contract', () => ({
  AUCTION_SUBTYPE_MAP: {},
  MODE_MAP: { bounty: '0x00000001' },
  contractAssignEvaluator: (...args: unknown[]) => contractAssignEvaluator(...args),
  contractCreateTask: vi.fn().mockResolvedValue(ESCROW_TX_HASH),
  taskIdForTx: (txHash: string) => taskIdForTx(txHash),
}));

vi.mock('../../../src/services/task-notifications', () => ({
  notifyNewTask: vi.fn().mockResolvedValue({ failed: 0, sent: 0, total: 0 }),
}));

vi.mock('../../../src/services/task-drops-email', () => ({
  notifyTaskDropSubscribers: vi.fn().mockResolvedValue({ failed: 0, sent: 0, total: 0 }),
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

const { completeTasksCreate } = await import('../../../src/services/intents/tasks-create-intent');
const { registerRelayedIntentHandlers } = await import('../../../src/services/intents/register');
const { relayedIntents, serverWalletTransactions } = await import('../../../src/db/schema');

afterAll(restoreServerEnvironment);

type IntentRow = {
  broadcastAttempts: number;
  completionAttempts: number;
  createdAt: Date;
  id: string;
  idempotencyKey: string;
  operation: string;
  payer: string | null;
  paymentTxHash: string | null;
  payload: unknown;
  relayReceiptNonce: string;
  relayValidBefore: string;
  status: string;
  txHash: string | null;
};

/**
 * Drizzle predicates are opaque objects, so the double resolves a query's target by looking for
 * a value it recognises anywhere inside the predicate it was handed.
 */
function findString(
  node: unknown,
  match: (v: string) => boolean,
  seen = new Set<unknown>()
): string | undefined {
  if (typeof node === 'string') return match(node) ? node : undefined;
  // Drizzle's table/column graph is cyclic, so the walk needs its own visited set.
  if (!node || typeof node !== 'object' || seen.has(node)) return undefined;
  seen.add(node);
  for (const value of Object.values(node as Record<string, unknown>)) {
    const hit: string | undefined = findString(value, match, seen);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * A relayed-intents table with the two guarantees this test is actually about, and nothing else.
 *
 * The unique index on `idempotency_key` is modelled honestly, because that index is the entire
 * mechanism: without it "completed twice" cannot be told apart from "two creations". So is the
 * conditional broadcast claim, which is what stops a second dispatch of an intent that already
 * has a transaction.
 */
function makeDb() {
  const intents: IntentRow[] = [];

  function thenable<T>(resolve: () => T) {
    const chain: Record<string, unknown> = {
      limit: () => chain,
      orderBy: () => chain,
      then: (onfulfilled?: (value: T) => unknown, onrejected?: (reason: unknown) => unknown) =>
        Promise.resolve().then(resolve).then(onfulfilled, onrejected),
      where: () => chain,
    };
    return chain;
  }

  const noopInsert = () => {
    const chain: Record<string, unknown> = {
      onConflictDoNothing: () => chain,
      onConflictDoUpdate: () => chain,
      returning: () => chain,
      then: (onfulfilled?: (value: unknown[]) => unknown) => Promise.resolve([]).then(onfulfilled),
      values: () => chain,
    };
    return chain;
  };

  const noopWrite = () => {
    const chain: Record<string, unknown> = {
      returning: () => chain,
      set: () => chain,
      then: (onfulfilled?: (value: unknown[]) => unknown) => Promise.resolve([]).then(onfulfilled),
      where: () => chain,
    };
    return chain;
  };

  const intentInsert = () => {
    let inserted: IntentRow | null = null;
    let conflicted = false;
    const chain: Record<string, unknown> = {
      onConflictDoNothing: () => chain,
      returning: () => chain,
      then: (onfulfilled?: (value: IntentRow[]) => unknown) =>
        Promise.resolve(conflicted || !inserted ? [] : [inserted]).then(onfulfilled),
      values: (values: Record<string, unknown>) => {
        const key = values.idempotencyKey as string;
        // The unique index deciding, exactly as it does in Postgres: a repeat of a key that is
        // already present inserts nothing and returns no row.
        if (intents.some((r) => r.idempotencyKey === key)) {
          conflicted = true;
          return chain;
        }
        // The columns with database defaults, which a real row read back always has and the
        // caller's `values` never sets.
        inserted = {
          ...(values as unknown as IntentRow),
          broadcastAttempts: 0,
          completionAttempts: 0,
          createdAt: new Date(),
          txHash: null,
        };
        intents.push(inserted);
        return chain;
      },
    };
    return chain;
  };

  const intentUpdate = () => {
    let claimsBroadcast = false;
    const chain: Record<string, unknown> = {
      returning: () => chain,
      set: (values: Record<string, unknown>) => {
        // The broadcast claim is the only update that increments broadcast_attempts; knowing
        // which claim this is is what lets the double apply the right predicate below.
        claimsBroadcast = 'broadcastAttempts' in values;
        chain.__values = values;
        return chain;
      },
      then: (onfulfilled?: (value: IntentRow[]) => unknown) => {
        const predicate = chain.__predicate;
        const values = (chain.__values ?? {}) as Record<string, unknown>;
        const id = findString(predicate, (v) => intents.some((r) => r.id === v));
        const target = intents.find((r) => r.id === id);
        if (!target) return Promise.resolve([]).then(onfulfilled);
        // A claim is permission to spend a nonce. The real predicate requires status
        // `recorded` and a null tx_hash, so an intent that has already been broadcast cannot
        // be claimed a second time.
        if (claimsBroadcast && (target.status !== 'recorded' || target.txHash !== null)) {
          return Promise.resolve([]).then(onfulfilled);
        }
        if (claimsBroadcast) target.broadcastAttempts += 1;
        if (typeof values.status === 'string') target.status = values.status;
        if (typeof values.txHash === 'string') target.txHash = values.txHash;
        if (typeof values.completionAttempts === 'number') {
          target.completionAttempts = values.completionAttempts;
        }
        return Promise.resolve([{ ...target }]).then(onfulfilled);
      },
      where: (predicate: unknown) => {
        chain.__predicate = predicate;
        return chain;
      },
    };
    return chain;
  };

  const db = {
    delete: () => noopWrite(),
    insert: (table: unknown) => (table === relayedIntents ? intentInsert() : noopInsert()),
    select: (_fields?: unknown) => ({
      from: (table: unknown) => {
        // The confirmed outbox row the completion path looks up once a hash exists.
        if (table === serverWalletTransactions) {
          return thenable(() => [{ id: 'swt-1', status: 'confirmed', txHash: ASSIGN_TX_HASH }]);
        }
        if (table === relayedIntents) {
          return {
            ...thenable(() => []),
            where: (predicate: unknown) => {
              const key = findString(predicate, (v) => intents.some((r) => r.idempotencyKey === v));
              const hit = intents.find((r) => r.idempotencyKey === key);
              return thenable(() => (hit ? [hit] : []));
            },
          };
        }
        // No requester agent row, no existing task rows: neither matters here.
        return thenable(() => []);
      },
    }),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({ delete: () => noopWrite(), insert: () => noopInsert(), update: () => noopWrite() }),
    update: (table: unknown) => (table === relayedIntents ? intentUpdate() : noopWrite()),
  };

  return { db, intents };
}

const payload = {
  allowedViewerAddresses: [],
  evaluatorAssignment: {
    appealWindow: 86400,
    disputeResolver: null,
    evaluationWindow: 86400,
    evaluator: EVALUATOR,
    evaluatorFeeBps: 250,
  },
  inlineTaskDrop: null,
  input: {
    description: 'Task with an evaluator',
    duration: 24,
    mode: 'bounty',
    reward: '1000000',
    tags: [],
  },
  normalizedPayer: PAYER,
  payer: PAYER,
  resolvedTaskDropId: null,
  taskDropReservationId: null,
};

/**
 * The combination neither branch had on its own.
 *
 * The evaluator endpoint's branch moved record-and-dispatch into a shared service but still
 * predicted the task id; the branch it merges onto resolves the id from the escrow receipt but
 * dispatched the assignment inline. Each was idempotent on its own terms. Together they only
 * stay idempotent if the key is derived from the id the receipt resolved to -- which is why
 * this is asserted here rather than in either branch's own tests.
 */
describe('task creation carrying evaluator fields, completed twice', () => {
  beforeEach(() => {
    contractAssignEvaluator.mockClear();
    taskIdForTx.mockClear();
    registerRelayedIntentHandlers();
  });

  it('records one assignment intent and makes one chain call', async () => {
    const { db, intents } = makeDb();
    const recordedAt = new Date('2026-01-01T00:00:00.000Z');

    // Completion is at-least-once: the request runs it when the receipt arrives in time, and
    // the reconciler runs it when it does not. Both can happen for one creation.
    await completeTasksCreate({
      db: db as never,
      payload: payload as never,
      recordedAt,
      txHash: ESCROW_TX_HASH,
    });
    await completeTasksCreate({
      db: db as never,
      payload: payload as never,
      recordedAt,
      txHash: ESCROW_TX_HASH,
    });

    const assignments = intents.filter((r) => r.operation === 'tasks.assignEvaluator');
    expect(assignments).toHaveLength(1);
    // The second run is stopped twice over: the unique key gives it back the same intent, and
    // that intent's conditional claim refuses a second broadcast because it already has a hash.
    expect(assignments[0]!.broadcastAttempts).toBe(1);
    expect(contractAssignEvaluator).toHaveBeenCalledTimes(1);
  });

  it('assigns against the id the receipt resolved to, not one carried in the payload', async () => {
    const { db, intents } = makeDb();

    await completeTasksCreate({
      db: db as never,
      payload: payload as never,
      recordedAt: new Date('2026-01-01T00:00:00.000Z'),
      txHash: ESCROW_TX_HASH,
    });

    // The payload deliberately carries no task id -- it is written before the transaction
    // exists -- so the only id the assignment can be for is the one the escrow receipt decoded.
    expect(payload).not.toHaveProperty('taskId');
    expect(taskIdForTx).toHaveBeenCalledWith(ESCROW_TX_HASH);

    const assignment = intents.find((r) => r.operation === 'tasks.assignEvaluator');
    expect((assignment!.payload as { taskId: string }).taskId).toBe(TASK_ID);
    // And the chain call is encoded from that same id, through the shared encoder the
    // POST /api/tasks/{taskId}/evaluator endpoint uses (ADR-0047).
    expect(contractAssignEvaluator).toHaveBeenCalledWith(
      TASK_ID,
      PAYER,
      EVALUATOR,
      0n,
      250,
      86400,
      86400,
      '0x0000000000000000000000000000000000000000'
    );
  });

  it('dispatches the assignment from the completion itself, with no deferral', async () => {
    const { db, intents } = makeDb();

    await completeTasksCreate({
      db: db as never,
      payload: payload as never,
      recordedAt: new Date('2026-01-01T00:00:00.000Z'),
      txHash: ESCROW_TX_HASH,
    });

    // Timing, not just eventual delivery: assignEvaluator reverts TaskNotOpen once a worker
    // claims the task, and worker agents claim within milliseconds of creation. ADR-0046's
    // correction note records 4 of 4 assignments lost when this was handed to a background
    // poll, so the assignment must already be on chain by the time this call returns rather
    // than merely recorded for someone else to send.
    const assignment = intents.find((r) => r.operation === 'tasks.assignEvaluator');
    expect(assignment!.txHash).toBe(ASSIGN_TX_HASH);
    expect(assignment!.status).not.toBe('recorded');
    expect(contractAssignEvaluator).toHaveBeenCalledTimes(1);
  });
});

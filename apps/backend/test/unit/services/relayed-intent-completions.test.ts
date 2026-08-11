// Verifies: ADR-0045
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { makeChain } from '../helpers';

vi.mock('../../../src/services/contract', () => ({
  blockNumberForTx: vi.fn().mockResolvedValue(4242),
  blockTimestampForTx: vi.fn().mockResolvedValue(1_800_000_000),
  contractAssignEvaluator: vi.fn().mockResolvedValue('0xassignhash'),
  contractProjectSettlementForTx: vi.fn().mockResolvedValue({ settlement: null, settledAt: null }),
  contractSubmitWork: vi.fn().mockResolvedValue('0xsubmitworkhash'),
  resolveRegisteredAgentId: vi.fn().mockResolvedValue(42n),
  // Decoded from the confirmed transaction's own TaskCreated log, so it is a function of the
  // hash and of nothing the payload could have carried (ADR-0045).
  taskIdForTx: vi.fn().mockResolvedValue(`0x${'a'.repeat(64)}`),
}));

vi.mock('../../../src/services/settlement-recorder', () => ({
  recordTaskSettlement: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/services/task-notifications', () => ({
  notifyNewTask: vi.fn().mockResolvedValue({ sent: 0, failed: 0, total: 0 }),
}));

vi.mock('../../../src/services/task-drops-email', () => ({
  notifyTaskDropSubscribers: vi.fn().mockResolvedValue({ sent: 0, failed: 0, total: 0 }),
}));

vi.mock('../../../src/config/env', () => ({
  getServerConfig: vi.fn().mockReturnValue({
    BACKEND_URL: 'http://localhost:3000',
    CHAIN_ID: 84532,
    CONTRACT_ADDRESS: '0x0000000000000000000000000000000000000001',
    DEFAULT_PLATFORM_FEE_BPS: 500,
    ERC8004_IDENTITY_REGISTRY: '0x0000000000000000000000000000000000008004',
  }),
}));

import {
  agents,
  bids,
  feedbacks,
  proofs,
  proposals,
  relayedIntents,
  submissions,
  taskAwards,
  tasks,
  type RelayedIntent,
} from '../../../src/db/schema';
import { registerRelayedIntentHandlers } from '../../../src/services/intents/register';
import { getRelayedIntentHandler } from '../../../src/services/relayed-intent-registry';
import { contractSubmitWork, resolveRegisteredAgentId } from '../../../src/services/contract';
import { recordTaskSettlement } from '../../../src/services/settlement-recorder';

registerRelayedIntentHandlers();

const TASK_ID = `0x${'a'.repeat(64)}`;
const WORKER = '0x1111111111111111111111111111111111111111';
const REQUESTER = '0x2222222222222222222222222222222222222222';
const TX_HASH = '0xconfirmedhash';

/**
 * A database whose writes are inspectable per table, since a completion handler's whole job
 * is which rows it writes -- there is no return value to assert on.
 */
function makeDb(
  seed: { insert?: Map<unknown, unknown>; update?: Map<unknown, unknown>; select?: unknown[] } = {}
) {
  const inserts = new Map<unknown, ReturnType<typeof makeChain>>();
  const updates = new Map<unknown, ReturnType<typeof makeChain>>();
  const chain = (store: Map<unknown, ReturnType<typeof makeChain>>, table: unknown, value: any) => {
    let existing = store.get(table);
    if (!existing) {
      existing = makeChain(value);
      store.set(table, existing);
    }
    return existing;
  };

  const db: any = {
    delete: vi.fn(() => makeChain()),
    // Resolves to a row because an insert that is read back -- recordRelayedIntent's, when a
    // completion starts a follow-on intent of its own -- needs one.
    insert: vi.fn((table: unknown) =>
      chain(inserts, table, seed.insert?.get(table) ?? [{ id: 'inserted' }])
    ),
    select: vi.fn(() => makeChain(seed.select ?? [])),
    update: vi.fn((table: unknown) => chain(updates, table, seed.update?.get(table) ?? [])),
  };
  db.transaction = vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback(db));
  return {
    db,
    insertChain: (table: unknown) =>
      chain(inserts, table, seed.insert?.get(table) ?? [{ id: 'inserted' }]),
    updateChain: (table: unknown) => chain(updates, table, seed.update?.get(table) ?? []),
  };
}

/**
 * Flatten a drizzle `where` condition to readable text.
 *
 * A guard is a property of the predicate, not of the values written, so `set` assertions
 * cannot see it -- these completions differ from their unguarded ancestors only here.
 */
function sqlText(node: any): string {
  if (node == null) return '';
  if (Array.isArray(node)) return node.map(sqlText).join(' ');
  if (typeof node === 'string') return node;
  if (node.queryChunks) return node.queryChunks.map(sqlText).join(' ');
  if (typeof node.name === 'string') return node.name;
  if ('value' in node) return JSON.stringify(node.value);
  return '';
}

function whereText(chain: ReturnType<typeof makeChain>): string {
  return chain.where.mock.calls.map((call: unknown[]) => sqlText(call[0])).join(' | ');
}

/**
 * The task statuses a guarded completion's predicate will actually match a row on.
 *
 * The three properties that matter -- a first completion applies, a late retry against a task
 * that has moved on does not, and a second completion against the status the handler itself
 * produces is still idempotent -- are all statements about this set, so it is read out of the
 * predicate rather than asserted as a substring of it. Substrings cannot tell "not in this set"
 * from "absent from the query", which is the difference between a guard and no guard.
 */
function allowedStatuses(chain: ReturnType<typeof makeChain>): string[] {
  const statuses = new Set<string>();
  const walk = (node: any): void => {
    if (node == null) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.queryChunks) return node.queryChunks.forEach(walk);
    if (typeof node.value === 'string') statuses.add(node.value);
  };
  chain.where.mock.calls.forEach((call: unknown[]) => walk(call[0]));
  // The task id is a bound value in the same predicate; it is not a status.
  statuses.delete(TASK_ID);
  return [...statuses];
}

function intent(operation: string, payload: unknown, createdAt = new Date()): RelayedIntent {
  return {
    createdAt,
    id: 'intent-1',
    operation,
    payer: REQUESTER,
    payload,
    status: 'broadcast',
  } as unknown as RelayedIntent;
}

async function complete(operation: string, payload: unknown, db: unknown, createdAt?: Date) {
  await getRelayedIntentHandler(operation)!({
    db: db as never,
    intent: intent(operation, payload, createdAt),
    txHash: TX_HASH,
  });
}

describe('relayed intent completions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Verifies: ADR-0050
  it('derives every task deadline from the intent record time, not the completion clock', async () => {
    // The requester paid for a task of a particular duration starting when they asked for it.
    // A completion running late off a reconciler pass must produce the same row as one that
    // ran inline, so two attempts at the same intent cannot disagree about when it expires.
    const recordedAt = new Date('2030-06-01T00:00:00.000Z');
    const createPayload = {
      allowedViewerAddresses: [],
      evaluatorAssignment: null,
      inlineTaskDrop: null,
      input: {
        bidDeadline: 48,
        description: 'work',
        duration: 24,
        pitchDeadline: 3600,
        reward: '1000000',
      },
      normalizedPayer: REQUESTER.toLowerCase(),
      payer: REQUESTER,
      resolvedTaskDropId: null,
      taskDropReservationId: null,
    };

    vi.useFakeTimers();
    try {
      vi.setSystemTime(recordedAt);
      const first = makeDb();
      await complete('tasks.create', createPayload, first.db, recordedAt);

      // An hour of reconciler backlog later, replaying the very same intent.
      vi.setSystemTime(new Date(recordedAt.getTime() + 3600 * 1000));
      const second = makeDb();
      await complete('tasks.create', createPayload, second.db, recordedAt);

      const deadlinesOf = (chain: ReturnType<typeof makeDb>['insertChain']) => {
        const values = chain(tasks).values.mock.calls[0]![0] as Record<string, Date>;
        return {
          bidDeadline: values.bidDeadline,
          expiryTime: values.expiryTime,
          pitchDeadline: values.pitchDeadline,
        };
      };

      expect(deadlinesOf(first.insertChain)).toEqual({
        bidDeadline: new Date(recordedAt.getTime() + 48 * 3600 * 1000),
        expiryTime: new Date(recordedAt.getTime() + 24 * 3600 * 1000),
        pitchDeadline: new Date(recordedAt.getTime() + 3600 * 1000),
      });
      expect(deadlinesOf(second.insertChain)).toEqual(deadlinesOf(first.insertChain));

      // The conflict path patches the same row the indexer may have inserted first, so it has
      // to agree with the insert rather than re-deriving from a second clock reading.
      const conflict = second.insertChain(tasks).onConflictDoUpdate.mock.calls[0]![0] as {
        set: Record<string, Date>;
      };
      expect(conflict.set.bidDeadline).toEqual(deadlinesOf(first.insertChain).bidDeadline);
      expect(conflict.set.pitchDeadline).toEqual(deadlinesOf(first.insertChain).pitchDeadline);
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies a confirmed task update, restoring the dates jsonb flattened to strings', async () => {
    const { db, updateChain } = makeDb();
    const expiryTime = new Date('2030-01-01T00:00:00.000Z');

    await complete(
      'tasks.update',
      { dbUpdate: { expiryTime: expiryTime.toISOString(), reward: '5000000' }, taskId: TASK_ID },
      db
    );

    // The payload round-trips through jsonb, which has no date type -- writing the string
    // straight back would hand drizzle something it cannot store in a timestamp column.
    expect(updateChain(tasks).set).toHaveBeenCalledWith({ expiryTime, reward: '5000000' });
  });

  it('closes a task on a confirmed cancel', async () => {
    const { db, updateChain } = makeDb();
    await complete('tasks.cancel', { taskId: TASK_ID }, db);
    expect(updateChain(tasks).set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled' })
    );
  });

  // Verifies: ADR-0050
  it('does not move an already-cancelled task cancelledAt forward on a retry', async () => {
    const { db, updateChain } = makeDb();
    await complete('tasks.cancel', { taskId: TASK_ID }, db);
    const where = whereText(updateChain(tasks));
    expect(where).toContain('cancelled_at');
    expect(where).toContain('is null');
  });

  it('expires a task on a confirmed refund', async () => {
    const { db, updateChain } = makeDb();
    await complete('tasks.refundExpired', { taskId: TASK_ID }, db);
    expect(updateChain(tasks).set).toHaveBeenCalledWith({ status: 'expired' });
  });

  it('marks the rejected submissions on a confirmed rejection', async () => {
    const { db, updateChain } = makeDb();
    await complete('tasks.rejectSubmission', { taskId: TASK_ID, worker: WORKER }, db);
    expect(updateChain(submissions).set).toHaveBeenCalledWith({ rejectedAt: expect.any(Date) });
  });

  it('flags a self-award acceptance, and leaves an ordinary one alone', async () => {
    const selfAward = makeDb();
    await complete(
      'acceptance.accept',
      { isSelfAward: true, taskId: TASK_ID, worker: REQUESTER },
      selfAward.db
    );
    expect(selfAward.updateChain(tasks).set).toHaveBeenCalledWith({ selfAward: true });

    const ordinary = makeDb();
    await complete(
      'acceptance.accept',
      { isSelfAward: false, taskId: TASK_ID, worker: WORKER },
      ordinary.db
    );
    expect(ordinary.db.update).not.toHaveBeenCalled();
  });

  it('records a rating with the block number read back from the receipt', async () => {
    // The intent payload is written before the transaction exists, so the block number can
    // only come from the confirmed receipt -- including on a reconciler pass hours later.
    const { db, insertChain, updateChain } = makeDb({
      update: new Map([[taskAwards, [{ id: 1 }]]]),
    });

    await complete(
      'acceptance.rate',
      {
        feedbackId: 'feedback-1',
        feedbackText: 'good work',
        fileContent: '{}',
        rating: 5,
        requesterAddress: REQUESTER,
        requesterAgentId: null,
        taskId: TASK_ID,
        worker: WORKER,
        workerAgentId: null,
      },
      db
    );

    expect(insertChain(feedbacks).values).toHaveBeenCalledWith(
      expect.objectContaining({ ratingBlockNumber: 4242, ratingTxHash: TX_HASH })
    );
    expect(updateChain(agents).set).toHaveBeenCalled();
  });

  it('does not count the same star twice when a rating completion is retried', async () => {
    // The conditional update claims the award only while it is still unrated; a second run
    // claims nothing, so the agent's running totals must not move again.
    const { db, updateChain } = makeDb({ update: new Map([[taskAwards, []]]) });

    await complete(
      'acceptance.rate',
      {
        feedbackId: 'feedback-1',
        feedbackText: null,
        fileContent: '{}',
        rating: 5,
        requesterAddress: REQUESTER,
        requesterAgentId: null,
        taskId: TASK_ID,
        worker: WORKER,
        workerAgentId: null,
      },
      db
    );

    expect(updateChain(agents).set).not.toHaveBeenCalled();
  });

  // Verifies: ADR-0045
  it('claims the award and bumps the aggregate in one transaction', async () => {
    // The award claim is a single-use token: it is what makes the counter increment safe. If
    // the process dies between the two, the guard is spent and no retry can restore the star,
    // so they have to commit together.
    const seen: unknown[] = [];
    const { db, updateChain } = makeDb({ update: new Map([[taskAwards, [{ id: 1 }]]]) });
    db.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const inner = {
        ...db,
        update: vi.fn((table: unknown) => (seen.push(table), updateChain(table))),
      };
      return callback(inner);
    });

    await complete(
      'acceptance.rate',
      {
        feedbackId: 'feedback-1',
        feedbackText: null,
        fileContent: '{}',
        rating: 5,
        requesterAddress: REQUESTER,
        requesterAgentId: null,
        taskId: TASK_ID,
        worker: WORKER,
        workerAgentId: null,
      },
      db
    );

    expect(seen).toEqual([taskAwards, agents]);
    expect(db.update).not.toHaveBeenCalledWith(agents);
  });

  it('upserts a confirmed bid rather than failing on the indexer having written it first', async () => {
    const { db, insertChain } = makeDb();
    await complete(
      'bids.submit',
      { bidId: 'bid-1', price: '2000000', taskId: TASK_ID, workerAddress: WORKER },
      db
    );
    expect(insertChain(bids).onConflictDoUpdate).toHaveBeenCalledOnce();
  });

  // Verifies: ADR-0050
  it('leaves a bid createdAt alone when the completion is retried', async () => {
    const { db, insertChain } = makeDb();
    await complete(
      'bids.submit',
      { bidId: 'bid-1', price: '2000000', taskId: TASK_ID, workerAddress: WORKER },
      db
    );
    const conflict = insertChain(bids).onConflictDoUpdate.mock.calls[0]![0] as {
      set: Record<string, unknown>;
    };
    expect(conflict.set).toEqual({ price: '2000000' });
  });

  it('claims the task for the worker whose auction accept confirmed', async () => {
    const { db, updateChain, insertChain } = makeDb({
      update: new Map([[tasks, [{ id: TASK_ID }]]]),
    });
    await complete(
      'bids.auctionAccept',
      {
        acceptedAt: new Date('2030-01-01T00:00:00.000Z').toISOString(),
        bidId: 'bid-1',
        price: '2000000',
        taskId: TASK_ID,
        workerAddress: WORKER,
      },
      db
    );
    expect(updateChain(tasks).set).toHaveBeenCalledWith(
      expect.objectContaining({ claimedBy: WORKER, status: 'claimed' })
    );
    expect(insertChain(bids).values).toHaveBeenCalled();
  });

  it('records a confirmed pitch with the hash of the transaction that anchored it', async () => {
    const { db, insertChain } = makeDb();
    await complete(
      'pitches.submit',
      {
        estimatedDuration: null,
        pitchHash: `0x${'b'.repeat(64)}`,
        pitchId: 'pitch-1',
        pitchText: 'my pitch',
        signature: '0xsig',
        taskId: TASK_ID,
        workerAddress: WORKER,
      },
      db
    );
    expect(insertChain(proposals).values).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pitch-1', submitTxHash: TX_HASH })
    );
  });

  it('selects one pitch, rejects the rest, and moves the task to worker_selected', async () => {
    const { db, updateChain } = makeDb();
    await complete(
      'pitches.select',
      { pitchId: 'pitch-1', taskId: TASK_ID, workerAddress: WORKER },
      db
    );
    expect(updateChain(proposals).set).toHaveBeenCalledTimes(2);
    expect(updateChain(tasks).set).toHaveBeenCalledWith({
      claimedBy: WORKER,
      status: 'worker_selected',
    });
  });

  // Verifies: ADR-0007
  it('will not move a task that has since been worked on back to worker_selected', async () => {
    // 'worker_selected' sits near the start of the lifecycle, so an unguarded late retry has
    // the longest way to drag a task backwards -- past submission, acceptance and settlement.
    const { db, updateChain } = makeDb();
    await complete(
      'pitches.select',
      { pitchId: 'pitch-1', taskId: TASK_ID, workerAddress: WORKER },
      db
    );

    const allowed = allowedStatuses(updateChain(tasks));
    // What CoreFacet.selectWorker permits the call from...
    expect(allowed).toContain('open');
    // ...plus its own result, so an indexer that processed TaskWorkerSelected first does not
    // cost us `claimedBy`.
    expect(allowed).toContain('worker_selected');
    expect(allowed).not.toContain('pending_approval');
    expect(allowed).not.toContain('completed');
    expect(allowed).not.toContain('cancelled');
  });

  it('starts the deliverable commitment as its own intent once the proof confirms', async () => {
    // One intent, one contract call (ADR-0047): the commitment is a second transaction, so
    // it gets a durable record of its own before it is sent, not a chained one. Its broadcast
    // claims that row with a conditional update, which has to match for the send to happen.
    const anchorRow = {
      id: 'anchor-intent',
      operation: 'proofs.anchorDeliverable',
      payload: {
        contractAddress: null,
        proofHash: `0x${'c'.repeat(64)}`,
        proofId: 'proof-1',
        signature: '0xsig',
        submissionId: 'submission-1',
        taskId: TASK_ID,
        workerAddress: WORKER,
      },
    };
    const { db, insertChain } = makeDb({
      insert: new Map([[relayedIntents, [anchorRow]]]),
      update: new Map([[relayedIntents, [anchorRow]]]),
    });
    await complete(
      'proofs.submit',
      {
        contractAddress: null,
        metricValue: '10',
        proofData: 'data',
        proofHash: `0x${'c'.repeat(64)}`,
        proofId: 'proof-1',
        proofType: 'url',
        signature: '0xsig',
        submissionId: 'submission-1',
        taskId: TASK_ID,
        workerAddress: WORKER,
      },
      db
    );

    expect(insertChain(proofs).values).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'proof-1', submitTxHash: TX_HASH })
    );
    expect(contractSubmitWork).toHaveBeenCalledOnce();
  });

  it('records the submission the deliverable commitment created, keyed on the proof', async () => {
    const { db, insertChain } = makeDb();
    await complete(
      'proofs.anchorDeliverable',
      {
        contractAddress: null,
        proofHash: `0x${'c'.repeat(64)}`,
        proofId: 'proof-1',
        signature: '0xsig',
        submissionId: 'submission-1',
        taskId: TASK_ID,
        workerAddress: WORKER,
      },
      db
    );
    expect(insertChain(submissions).values).toHaveBeenCalledWith(
      expect.objectContaining({ fileUrl: 'taskmarket-proof:proof-1', id: 'submission-1' })
    );
  });

  it('anchors the appeal deadline to the block the evaluation landed in', async () => {
    const { db, updateChain } = makeDb({
      select: [{ appealWindow: 86_400, expiryTime: new Date(0) }],
    });
    await complete(
      'evaluations.evaluate',
      {
        awards: [{ amount: '1000000', rank: 1, worker: WORKER }],
        confidence: 90,
        evidenceHash: `0x${'d'.repeat(64)}`,
        mode: 'bounty',
        score: 80,
        taskId: TASK_ID,
        verdict: 'approve',
      },
      db
    );

    expect(updateChain(tasks).set).toHaveBeenCalledWith(
      expect.objectContaining({
        appealDeadline: new Date((1_800_000_000 + 86_400) * 1000),
        status: 'appealing',
        verdictType: 'APPROVE',
      })
    );
  });

  // Verifies: ADR-0050
  it('will not drag a task that has moved past its appeal window back to appealing', async () => {
    // 'appealing' is mid-lifecycle, so a late retry must not undo disputed/completed/cancelled
    // -- unlike finalizeVerdict below, whose writes are terminal and deliberately unguarded.
    const { db, updateChain } = makeDb({
      select: [{ appealWindow: 86_400, expiryTime: new Date(0) }],
    });
    await complete(
      'evaluations.evaluate',
      {
        awards: [],
        confidence: 90,
        evidenceHash: `0x${'d'.repeat(64)}`,
        mode: 'bounty',
        score: 80,
        taskId: TASK_ID,
        verdict: 'approve',
      },
      db
    );

    const where = whereText(updateChain(tasks));
    expect(where).toContain('status');
    // 'appealing' is in the allowed set on purpose: the indexer can write the status first,
    // and the fields it cannot derive still have to land.
    for (const status of ['open', 'pending_approval', 'review', 'appealing']) {
      expect(where).toContain(status);
    }
    expect(where).not.toContain('disputed');
  });

  it('disputes a task on a confirmed appeal', async () => {
    const { db, updateChain } = makeDb();
    await complete('evaluations.appeal', { taskId: TASK_ID }, db);
    expect(updateChain(tasks).set).toHaveBeenCalledWith({ status: 'disputed' });
  });

  // Verifies: ADR-0007
  it('will not drag a task the resolver has already settled back to disputed', async () => {
    // 'disputed' is mid-lifecycle, not terminal: resolveDispute settles the task out of it. A
    // reconciler retry landing after that would undo a completed settlement in the database
    // while the chain says otherwise -- the ADR-0007 regression.
    const { db, updateChain } = makeDb();
    await complete('evaluations.appeal', { taskId: TASK_ID }, db);

    const allowed = allowedStatuses(updateChain(tasks));
    // What EvaluatorFacet.appeal permits the call from, so the legitimate first completion
    // applies...
    expect(allowed).toContain('appealing');
    // ...plus its own result, so a second completion after the indexer wrote the status is
    // idempotent rather than skipped.
    expect(allowed).toContain('disputed');
    // ...and nothing the task can have moved on to since.
    expect(allowed).not.toContain('completed');
    expect(allowed).not.toContain('cancelled');
    expect(allowed).not.toContain('expired');
  });

  it('completes a zero-award dispute resolution when the receipt carries no settlement', async () => {
    const { db, updateChain } = makeDb();
    await complete('evaluations.resolveDispute', { firstAwardWorker: WORKER, taskId: TASK_ID }, db);
    expect(recordTaskSettlement).not.toHaveBeenCalled();
    expect(updateChain(tasks).set).toHaveBeenCalledWith({
      claimedBy: WORKER,
      status: 'completed',
    });
  });

  it('returns a timed-out evaluation to the requester for approval', async () => {
    const { db, updateChain } = makeDb();
    await complete('evaluations.evaluatorTimeout', { taskId: TASK_ID }, db);
    expect(updateChain(tasks).set).toHaveBeenCalledWith(
      expect.objectContaining({ evaluator: null, status: 'pending_approval' })
    );
  });

  // Verifies: ADR-0007
  it('will not return a task the requester has already accepted to pending_approval', async () => {
    // 'pending_approval' is mid-lifecycle: acceptance, rejection, cancellation and expiry all
    // move past it, so an unguarded late retry reopens a settled task for approval.
    const { db, updateChain } = makeDb();
    await complete('evaluations.evaluatorTimeout', { taskId: TASK_ID }, db);

    const allowed = allowedStatuses(updateChain(tasks));
    // What EvaluatorFacet.evaluatorTimeout permits the call from...
    expect(allowed).toContain('review');
    // ...plus its own result, so the indexer's EvaluatorTimedOut handler winning the race does
    // not cost us the fields it cannot derive.
    expect(allowed).toContain('pending_approval');
    expect(allowed).not.toContain('completed');
    expect(allowed).not.toContain('cancelled');
    expect(allowed).not.toContain('expired');
  });

  it('binds the minted agentId, decoded from the mint transaction, to the paying wallet', async () => {
    const { db, insertChain } = makeDb();
    await complete(
      'identity.register',
      {
        chainId: 84532,
        existingAddress: null,
        payer: WORKER,
        registeredVia: 'cli',
        registryAddress: '0x0000000000000000000000000000000000008004',
      },
      db
    );

    expect(resolveRegisteredAgentId).toHaveBeenCalledWith(TX_HASH);
    expect(insertChain(agents).values).toHaveBeenCalledWith(
      expect.objectContaining({ address: WORKER, agentId: '42' })
    );
  });

  it('updates a legacy differently-cased row in place instead of inserting a second one', async () => {
    const legacy = '0xAbCd111111111111111111111111111111111111';
    const { db, updateChain } = makeDb();
    await complete(
      'identity.register',
      {
        chainId: 84532,
        existingAddress: legacy,
        payer: WORKER,
        registeredVia: 'cli',
        registryAddress: '0x0000000000000000000000000000000000008004',
      },
      db
    );

    expect(updateChain(agents).set).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: '42' })
    );
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('has nothing to do for a confirmed multi-winner acceptance', async () => {
    // Deliberately empty: awards, status and earnings all come from the chain's own
    // TaskCompleted events. The intent exists for the payment reference, not for this.
    const { db } = makeDb();
    await complete('acceptance.acceptSubmissions', { taskId: TASK_ID, winners: [] }, db);
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  // Verifies: ADR-0045
  it('rejects an artifact-less submission payload before opening a transaction', async () => {
    // The payload is jsonb read back by a process that never saw the request, so the empty
    // case is representable however carefully the routers build it. It must name the problem
    // rather than surfacing as a TypeError from inside the transaction.
    const { db } = makeDb();
    await expect(
      complete(
        'submissions.submit',
        {
          artifacts: [],
          contractAddress: null,
          deliverableHash: `0x${'e'.repeat(64)}`,
          mode: 'bounty',
          signature: '0xsig',
          submissionId: 'submission-1',
          taskId: TASK_ID,
          workerAddress: WORKER,
        },
        db
      )
    ).rejects.toThrow('has no artifacts');
    expect(db.transaction).not.toHaveBeenCalled();
  });
});

describe('completePitchesSelect guards the task but deliberately not the proposals', () => {
  // This exists to stop a future reader "fixing" the asymmetry for symmetry's sake. The task
  // update is guarded on the statuses selection may legally move from; the two proposal updates
  // are not, and must not be. The only natural predicate for them is the task's own status, and
  // that is exactly what makes one wrong: a legitimate first completion racing an indexer that
  // has already moved the task past 'worker_selected' would be skipped, and the pitches would
  // sit at 'pending' for ever with no later pass to repair them.
  //
  // Re-stamping on a stale rerun costs nothing in exchange: both values are fixed, and
  // `pitches.submit` refuses a task that is not open, so the pitch set is frozen once selection
  // happens and a late rerun writes each row the value it already holds.
  it('stamps both proposal statuses unconditionally and gates only the task write', async () => {
    const { db, updateChain } = makeDb();

    await complete(
      'pitches.select',
      {
        contractAddress: null,
        pitchId: 'pitch-1',
        taskId: TASK_ID,
        workerAddress: WORKER,
      },
      db
    );

    // Both proposal writes are issued, and neither carries a status precondition of its own.
    expect(updateChain(proposals).set.mock.calls.map(([value]: [unknown]) => value)).toEqual([
      { status: 'selected' },
      { status: 'rejected' },
    ]);

    // The task write is the guarded one, and it is guarded on where selection may move from.
    expect(updateChain(tasks).set).toHaveBeenCalledWith({
      claimedBy: WORKER,
      status: 'worker_selected',
    });
  });
});

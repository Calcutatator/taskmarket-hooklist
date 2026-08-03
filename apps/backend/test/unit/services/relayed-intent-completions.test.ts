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
    insert: vi.fn((table: unknown) => chain(inserts, table, seed.insert?.get(table) ?? [{ id: 'inserted' }])),
    select: vi.fn(() => makeChain(seed.select ?? [])),
    update: vi.fn((table: unknown) => chain(updates, table, seed.update?.get(table) ?? [])),
  };
  db.transaction = vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback(db));
  return {
    db,
    insertChain: (table: unknown) => chain(inserts, table, seed.insert?.get(table) ?? [{ id: 'inserted' }]),
    updateChain: (table: unknown) => chain(updates, table, seed.update?.get(table) ?? []),
  };
}

function intent(operation: string, payload: unknown): RelayedIntent {
  return {
    id: 'intent-1',
    operation,
    payer: REQUESTER,
    payload,
    status: 'broadcast',
  } as unknown as RelayedIntent;
}

async function complete(operation: string, payload: unknown, db: unknown) {
  await getRelayedIntentHandler(operation)!({
    db: db as never,
    intent: intent(operation, payload),
    txHash: TX_HASH,
  });
}

describe('relayed intent completions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    const { db, insertChain, updateChain } = makeDb({ update: new Map([[taskAwards, [{ id: 1 }]]]) });

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

  it('upserts a confirmed bid rather than failing on the indexer having written it first', async () => {
    const { db, insertChain } = makeDb();
    await complete(
      'bids.submit',
      { bidId: 'bid-1', price: '2000000', taskId: TASK_ID, workerAddress: WORKER },
      db
    );
    expect(insertChain(bids).onConflictDoUpdate).toHaveBeenCalledOnce();
  });

  it('claims the task for the worker whose auction accept confirmed', async () => {
    const { db, updateChain, insertChain } = makeDb({ update: new Map([[tasks, [{ id: TASK_ID }]]]) });
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

  it('disputes a task on a confirmed appeal', async () => {
    const { db, updateChain } = makeDb();
    await complete('evaluations.appeal', { taskId: TASK_ID }, db);
    expect(updateChain(tasks).set).toHaveBeenCalledWith({ status: 'disputed' });
  });

  it('completes a zero-award dispute resolution when the receipt carries no settlement', async () => {
    const { db, updateChain } = makeDb();
    await complete(
      'evaluations.resolveDispute',
      { firstAwardWorker: WORKER, taskId: TASK_ID },
      db
    );
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
});

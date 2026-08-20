// Implements: ADR-0045
// Implements: ADR-0055
import { eq } from 'drizzle-orm';
import { keccak256, toHex } from 'viem';

import type { db as DbType } from '../../db/client';
import {
  agents,
  taskAllowedViewers,
  taskDropTaskReservations,
  taskDrops,
  tasks,
} from '../../db/schema';
import { getServerConfig } from '../../config/env';
import { lowerAddressEq } from '../../lib/agents';
import { logger } from '../../lib/logger';
import { normalizeRequesterPublicKey } from '../../lib/task';
import { mintUniqueReferenceCode } from '../reference-code-minting';
import { notifyTaskDropSubscribers } from '../task-drops-email';
import { notifyNewTask } from '../task-notifications';
import { AUCTION_SUBTYPE_MAP, contractCreateTask, MODE_MAP, taskIdForTx } from '../contract';

type Db = typeof DbType;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

/**
 * The validated request body, as it is read back out of the intent's jsonb payload.
 *
 * Named rather than inlined at each cast because two places now read it: the completion, and
 * the broadcaster that rebuilds the contract call from the payload alone. A field the two
 * disagreed about would mean a rebroadcast creating a subtly different task from the one the
 * requester paid for.
 */
/**
 * Drops the plaintext access password, and is the only supported way to build a
 * `TasksCreateInput` from a create request.
 *
 * A function rather than a `delete` at the call site so that stripping the password is what
 * *produces* the type, instead of a cast asserting afterwards that it happened. The payload is
 * durable and gets replayed by the broadcaster, so a plaintext password reaching it would be
 * written down and re-read long after the request that carried it.
 */
export function toTasksCreateInput({
  accessPassword: _accessPassword,
  ...input
}: TasksCreateInput & { accessPassword?: string | null }): TasksCreateInput {
  return input;
}

export type TasksCreateInput = {
  // No `accessPassword`. `toTasksCreateInput` strips it and the payload carries only the hash,
  // on the payload itself rather than in here -- see `accessPasswordHash` below.
  allowedViewers?: string[];
  auctionFloorPrice?: string | null;
  auctionStartPrice?: string | null;
  auctionType?: string | null;
  bidDeadline?: number | null;
  description: string;
  duration: number;
  hookContract?: string | null;
  hookData?: string | null;
  maxPrice?: string | null;
  metricDescription?: string | null;
  metricTarget?: string | null;
  mode?: string;
  pitchDeadline?: number | null;
  reward: string;
  // Required, not optional-with-a-default: `TaskCreateSchema` applies `.default(0)` before this
  // payload is serialised, so every persisted intent already carries the value the requester's
  // escrow was priced against. Re-defaulting it at read time would let a rebroadcast hours later
  // quietly substitute its own number for a stake the requester actually chose.
  stakeBps: number;
  stakeRequired?: boolean;
  submissionVisibility?: string;
  tags?: string[];
  taskVisibility?: string;
};

/**
 * Everything the completion needs, captured at request time.
 *
 * Deliberately plain and serializable: this is persisted as jsonb and may be read back by a
 * reconciler pass in a different process, hours later, with no request context to fall back on.
 *
 * It identifies the *operation*, never its result. Neither the task id nor the escrow hash is
 * here, and for the same reason: both are facts about a transaction that does not exist when
 * this row is written. They arrive at the completion as arguments, from whichever of the
 * request or the reconciler observed the receipt.
 */
export type TasksCreateIntentPayload = {
  /**
   * The scrypt hash of a private task's access password, already computed by the request, or
   * null when the task is public or no password was set.
   *
   * The hash rather than the password, because this row outlives the request by design: it is
   * jsonb a reconciler reads back hours later, and it sits in backups long after the task it
   * guarded is over. A user-chosen secret is the one thing on this payload that must never be
   * recoverable from it, so the plaintext never leaves the request handler.
   */
  accessPasswordHash: string | null;
  allowedViewerAddresses: string[];
  evaluatorAssignment: {
    appealWindow: number;
    disputeResolver: string | null;
    evaluationWindow: number;
    evaluator: string;
    evaluatorFeeBps: number;
  } | null;
  inlineTaskDrop: {
    description: string | null;
    id: string;
    name: string;
    ownerAddress: string;
  } | null;
  // Typed, not `Record<string, unknown>`: this is the one place the request side and the two
  // read sides agree about what was captured, so a field the readers require (`stakeBps`) is
  // checked against what the writer actually puts here rather than cast into existence twice.
  input: TasksCreateInput;
  normalizedPayer: string;
  payer: string;
  resolvedTaskDropId: string | null;
  taskDropReservationId: string | null;
};

/**
 * Broadcast a task creation from nothing but its persisted payload.
 *
 * The single place the contract call is built, used by the request that records the intent
 * and by the rebroadcast sweep that picks up one nobody sent (ADR-0050). One builder rather
 * than two is the point: a rebroadcast must be the *same* call, since a call that differed in
 * any argument would be a different task from the one the requester paid for.
 *
 * A second landing cannot create a second task. The forwarder's `relay` consumes a receipt
 * hash over (chainId, pgtrSender, paymentAmount, receiptNonce, validBefore, taskMarket,
 * selector) and reverts `ReceiptAlreadyConsumed` on a repeat -- and every one of those is
 * immutable across attempts, because a rebroadcast replays the intent's stored envelope
 * verbatim (ADR-0050 point 7). So if the original transaction did land, the retry reverts on
 * chain rather than escrowing a second reward.
 */
export async function broadcastTasksCreate(context: {
  payload: TasksCreateIntentPayload;
  paymentTxHash: `0x${string}` | null;
}): Promise<`0x${string}`> {
  const input = context.payload.input;
  const durationSecs = BigInt(Math.round(input.duration * 3600));
  const mode = MODE_MAP[input.mode ?? 'bounty'] ?? MODE_MAP['bounty']!;

  return contractCreateTask(
    context.payload.payer as `0x${string}`,
    BigInt(input.reward),
    durationSecs,
    mode,
    input.mode === 'pitch'
      ? input.pitchDeadline
        ? BigInt(input.pitchDeadline)
        : durationSecs
      : 0n,
    input.mode === 'auction'
      ? input.bidDeadline
        ? BigInt(input.bidDeadline * 3600)
        : durationSecs
      : 0n,
    input.mode === 'auction' && input.auctionType
      ? (AUCTION_SUBTYPE_MAP[input.auctionType] ?? ('0x00000000' as `0x${string}`))
      : ('0x00000000' as `0x${string}`),
    input.stakeRequired ?? false,
    input.stakeBps,
    (input.hookContract ?? ZERO_ADDRESS) as `0x${string}`,
    (input.tags ?? []).map((tag) => keccak256(toHex(tag)) as `0x${string}`),
    (input.hookData ?? '0x') as `0x${string}`,
    context.paymentTxHash ?? undefined,
    // The evaluator, if there is one, is configured by this same transaction. It used to be a
    // second relayed call issued once this one confirmed, which raced the first worker to claim
    // and lost often enough to matter (ADR-0047). A rebroadcast replays this builder verbatim,
    // so the evaluator terms travel with the escrow on every attempt rather than depending on a
    // follow-on record that may or may not exist.
    context.payload.evaluatorAssignment
      ? {
          appealWindowSecs: context.payload.evaluatorAssignment.appealWindow,
          disputeResolver: (context.payload.evaluatorAssignment.disputeResolver ??
            ZERO_ADDRESS) as `0x${string}`,
          evaluationWindowSecs: context.payload.evaluatorAssignment.evaluationWindow,
          evaluator: context.payload.evaluatorAssignment.evaluator as `0x${string}`,
          evaluatorFeeBps: context.payload.evaluatorAssignment.evaluatorFeeBps,
        }
      : undefined
  );
}

/**
 * The work that follows a confirmed task-creation escrow.
 *
 * Runs from the request when the receipt arrives in time, and from the reconciler when it does
 * not. One implementation for both, so a late receipt produces exactly the same task, drop,
 * viewers and notifications as a timely one -- the silent gap ADR-0045 exists to close.
 *
 * Idempotent throughout: the task insert already tolerates the chain-event indexer winning the
 * race, and every other write is either conditional or naturally repeatable. Resolving the id
 * from the receipt is idempotent in the same sense -- the same hash always decodes to the same
 * id, so a rerun writes the same row rather than a second one.
 */
export async function completeTasksCreate(context: {
  db: Db;
  payload: TasksCreateIntentPayload;
  recordedAt: Date;
  txHash: `0x${string}`;
}): Promise<void> {
  const { db, payload, recordedAt } = context;
  const input = payload.input;

  const config = getServerConfig();
  // The chain's id, not a prediction of it. The payload cannot carry a task id: it is written
  // before the transaction exists, and the contract does not derive the id until it runs, from
  // a requester nonce any concurrent creation can move underneath a prediction. See
  // taskIdForTx for what that cost before this changed.
  const taskId = await taskIdForTx(context.txHash);
  // Every deadline is derived from the intent's own record time, never from the wall clock at
  // completion time. The requester signed and paid for a task with a particular duration
  // starting when they asked for it; a completion that runs an hour late off a reconciler pass
  // must produce the same row as one that ran inline, or two attempts at the same intent
  // disagree about when the task expires (ADR-0050 point 7 -- a payload is replayed verbatim,
  // nothing time-derived is recomputed per attempt).
  const createdAtMs = recordedAt.getTime();
  const expiryTime = new Date(createdAtMs + input.duration * 3600 * 1000);
  const taskVisibility = input.taskVisibility ?? 'public';
  const submissionVisibility = input.submissionVisibility ?? 'public';
  // Already hashed by the request; there is no plaintext here to hash and deliberately never
  // was one on the payload. Still gated on visibility so a payload whose visibility says
  // public cannot carry a password hash onto the row.
  const privateAccessPasswordHash =
    taskVisibility === 'private' ? (payload.accessPasswordHash ?? null) : null;

  const requesterAgent = await db
    .select({ agentId: agents.agentId, publicKey: agents.publicKey })
    .from(agents)
    .where(lowerAddressEq(payload.payer))
    .limit(1);

  // The evaluator columns are written here because the creation transaction is what configures
  // them now. They are not derivable from the EvaluatorAssigned event alone -- the event carries
  // only the evaluator and the stake, not the fee, the windows or the dispute resolver -- so the
  // indexer cannot backfill them and this path is their sole source of truth. Left absent
  // entirely when there is no evaluator, rather than written as nulls: a later
  // POST /api/tasks/{id}/evaluator may legitimately have set them between the indexer's insert
  // and this one, and a re-run of this completion must not erase that.
  const evaluatorColumns = payload.evaluatorAssignment
    ? {
        appealWindow: payload.evaluatorAssignment.appealWindow,
        disputeResolver: payload.evaluatorAssignment.disputeResolver,
        evaluationWindow: payload.evaluatorAssignment.evaluationWindow,
        evaluator: payload.evaluatorAssignment.evaluator,
        evaluatorFeeBps: payload.evaluatorAssignment.evaluatorFeeBps,
      }
    : {};

  await db.transaction(async (tx) => {
    if (payload.inlineTaskDrop) {
      await tx.insert(taskDrops).values(payload.inlineTaskDrop).onConflictDoNothing();
    }

    const requesterPubkeyValue =
      normalizeRequesterPublicKey(requesterAgent[0]?.publicKey, null) ?? '';
    const pitchDeadlineValue = input.pitchDeadline
      ? new Date(createdAtMs + input.pitchDeadline * 1000)
      : null;
    const bidDeadlineValue = input.bidDeadline
      ? new Date(createdAtMs + input.bidDeadline * 3600 * 1000)
      : null;
    const requesterAgentIdValue = requesterAgent[0]?.agentId ?? null;

    await tx
      .insert(tasks)
      .values({
        auctionFloorPrice: input.auctionFloorPrice ?? null,
        auctionStartPrice: input.auctionStartPrice ?? null,
        auctionType: input.auctionType ?? null,
        bidDeadline: bidDeadlineValue,
        chainId: config.CHAIN_ID,
        contractAddress: config.CONTRACT_ADDRESS,
        description: input.description,
        escrowTxHash: context.txHash,
        expiryTime,
        hookContract: input.hookContract ?? null,
        id: taskId,
        maxPrice: input.maxPrice ?? null,
        metricDescription: input.metricDescription ?? null,
        metricTarget: input.metricTarget ?? null,
        mode: input.mode ?? 'bounty',
        pitchDeadline: pitchDeadlineValue,
        platformFeeBps: config.DEFAULT_PLATFORM_FEE_BPS,
        privateAccessPasswordHash,
        // ADR-0098. Whichever writer reaches the row first mints its one code: this completion, or
        // the indexer's reconciliation pass over the same TaskCreated event. The other finds the
        // id already present and does nothing.
        referenceCode: await mintUniqueReferenceCode({ db: tx, entity: 'task' }),
        requester: payload.payer,
        requesterAgentId: requesterAgentIdValue,
        requesterPubkey: requesterPubkeyValue,
        reward: input.reward,
        stakeBps: input.stakeBps,
        stakeRequired: input.stakeRequired ? 1 : 0,
        status: 'open',
        submissionVisibility,
        tags: input.tags ?? [],
        taskDropId: payload.resolvedTaskDropId,
        taskVisibility,
        ...evaluatorColumns,
      })
      // The chain-event indexer (services/indexer.ts's processTaskCreatedEvent) also inserts a
      // row for this id on the on-chain TaskCreated event, with only on-chain-derivable fields
      // populated, and can win the race against this insert. onConflictDoUpdate patches in the
      // off-chain-only fields this path is the sole source of truth for -- excluding
      // status/claimedBy/claimedAt (owned by claim/settlement events), hookContract (reconciled
      // by its own event handler), and the fields the indexer already derives
      // correctly from the same event. This is also what makes re-running the completion safe.
      //
      // referenceCode is deliberately absent from `set`: whichever writer created the row minted
      // the one code, and patching it here would hand the same task a second public name after
      // someone may already have quoted the first (ADR-0098).
      .onConflictDoUpdate({
        target: tasks.id,
        set: {
          auctionFloorPrice: input.auctionFloorPrice ?? null,
          auctionStartPrice: input.auctionStartPrice ?? null,
          auctionType: input.auctionType ?? null,
          bidDeadline: bidDeadlineValue,
          description: input.description,
          maxPrice: input.maxPrice ?? null,
          metricDescription: input.metricDescription ?? null,
          metricTarget: input.metricTarget ?? null,
          pitchDeadline: pitchDeadlineValue,
          privateAccessPasswordHash,
          requesterAgentId: requesterAgentIdValue,
          requesterPubkey: requesterPubkeyValue,
          submissionVisibility,
          tags: input.tags ?? [],
          taskDropId: payload.resolvedTaskDropId,
          taskVisibility,
          ...evaluatorColumns,
        },
      });

    if (payload.taskDropReservationId) {
      await tx
        .delete(taskDropTaskReservations)
        .where(eq(taskDropTaskReservations.reservationId, payload.taskDropReservationId));
    }

    if (payload.allowedViewerAddresses.length > 0) {
      await tx
        .insert(taskAllowedViewers)
        .values(
          payload.allowedViewerAddresses.map((viewerAddress) => ({
            addedBy: payload.normalizedPayer,
            taskId,
            viewerAddress,
          }))
        )
        .onConflictDoNothing();
    }
  });

  // Unlisted and private tasks opt out of Taskmarket's own discovery surfaces (ADR-0014,
  // ADR-0030) -- that includes outbound notifications, since actively pinging worker agents
  // about an "unlisted" or "private" task would defeat the point.
  if (taskVisibility !== 'unlisted' && taskVisibility !== 'private') {
    // Fire-and-forget, and idempotent by taskId, so a repeated completion cannot double-send.
    void notifyNewTask({
      db,
      description: input.description,
      mode: input.mode ?? 'bounty',
      reward: input.reward,
      tags: input.tags,
      taskId,
    }).catch((err: unknown) => {
      logger.warn(
        `notifyNewTask failed for task ${taskId}: ${err instanceof Error ? err.message : String(err)}`
      );
    });

    if (payload.resolvedTaskDropId) {
      void notifyTaskDropSubscribers({
        db,
        description: input.description,
        mode: input.mode ?? 'bounty',
        reward: input.reward,
        tags: input.tags,
        taskDropId: payload.resolvedTaskDropId,
        taskId,
      }).catch((err: unknown) => {
        logger.warn(
          `notifyTaskDropSubscribers failed for task ${taskId}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      });
    }
  }
}

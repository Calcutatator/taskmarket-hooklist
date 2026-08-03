// Implements: ADR-0045
// Implements: ADR-0046
import { eq } from 'drizzle-orm';

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
import { hashTaskAccessPassword } from '../../lib/task-access-password';
import { logger } from '../../lib/logger';
import { normalizeRequesterPublicKey } from '../../lib/task';
import { notifyTaskDropSubscribers } from '../task-drops-email';
import { notifyNewTask } from '../task-notifications';
import { enqueueFollowOnIntent } from '../relayed-intents';
import type { RelayedIntent } from '../../db/schema';

type Db = typeof DbType;

/**
 * Everything the completion needs, captured at request time.
 *
 * Deliberately plain and serializable: this is persisted as jsonb and may be read back by a
 * reconciler pass in a different process, hours later, with no request context to fall back on.
 */
export type TasksCreateIntentPayload = {
  allowedViewerAddresses: string[];
  escrowTxHash: string;
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
  input: Record<string, unknown>;
  normalizedPayer: string;
  payer: string;
  resolvedTaskDropId: string | null;
  taskDropReservationId: string | null;
  taskId: string;
};

/**
 * The work that follows a confirmed task-creation escrow.
 *
 * Runs from the request when the receipt arrives in time, and from the reconciler when it does
 * not. One implementation for both, so a late receipt produces exactly the same task, drop,
 * viewers and notifications as a timely one -- the silent gap ADR-0045 exists to close.
 *
 * Idempotent throughout: the task insert already tolerates the chain-event indexer winning the
 * race, and every other write is either conditional or naturally repeatable.
 */
export async function completeTasksCreate(context: {
  db: Db;
  intent?: RelayedIntent;
  payload: TasksCreateIntentPayload;
}): Promise<void> {
  const { db, payload } = context;
  const input = payload.input as {
    accessPassword?: string;
    allowedViewers?: string[];
    auctionFloorPrice?: string | null;
    auctionStartPrice?: string | null;
    auctionType?: string | null;
    bidDeadline?: number | null;
    description: string;
    duration: number;
    hookContract?: string | null;
    maxPrice?: string | null;
    metricDescription?: string | null;
    metricTarget?: string | null;
    mode?: string;
    pitchDeadline?: number | null;
    reward: string;
    stakeBps?: number;
    stakeRequired?: boolean;
    submissionVisibility?: string;
    tags?: string[];
    taskVisibility?: string;
  };

  const config = getServerConfig();
  const { taskId } = payload;
  const expiryTime = new Date(Date.now() + input.duration * 3600 * 1000);
  const taskVisibility = input.taskVisibility ?? 'public';
  const submissionVisibility = input.submissionVisibility ?? 'public';
  const privateAccessPasswordHash =
    taskVisibility === 'private' && input.accessPassword
      ? hashTaskAccessPassword(input.accessPassword)
      : null;

  const requesterAgent = await db
    .select({ agentId: agents.agentId, publicKey: agents.publicKey })
    .from(agents)
    .where(lowerAddressEq(payload.payer))
    .limit(1);

  await db.transaction(async (tx) => {
    if (payload.inlineTaskDrop) {
      await tx.insert(taskDrops).values(payload.inlineTaskDrop).onConflictDoNothing();
    }

    const requesterPubkeyValue =
      normalizeRequesterPublicKey(requesterAgent[0]?.publicKey, null) ?? '';
    const pitchDeadlineValue = input.pitchDeadline
      ? new Date(Date.now() + input.pitchDeadline * 1000)
      : null;
    const bidDeadlineValue = input.bidDeadline
      ? new Date(Date.now() + input.bidDeadline * 3600 * 1000)
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
        escrowTxHash: payload.escrowTxHash,
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
        requester: payload.payer,
        requesterAgentId: requesterAgentIdValue,
        requesterPubkey: requesterPubkeyValue,
        reward: input.reward,
        stakeBps: input.stakeBps ?? 0,
        stakeRequired: input.stakeRequired ? 1 : 0,
        status: 'open',
        submissionVisibility,
        tags: input.tags ?? [],
        taskDropId: payload.resolvedTaskDropId,
        taskVisibility,
      })
      // The chain-event indexer (services/indexer.ts's processTaskCreatedEvent) also inserts a
      // row for this id on the on-chain TaskCreated event, with only on-chain-derivable fields
      // populated, and can win the race against this insert. onConflictDoUpdate patches in the
      // off-chain-only fields this path is the sole source of truth for -- excluding
      // status/claimedBy/claimedAt (owned by claim/settlement events), hookContract/evaluator*
      // (reconciled by their own event handlers), and the fields the indexer already derives
      // correctly from the same event. This is also what makes re-running the completion safe.
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

  // Evaluator assignment is a second on-chain call, so it becomes the next link in the chain
  // rather than being broadcast from here -- a transaction sent from a completion handler
  // would have no durable record of its own (ADR-0046).
  if (payload.evaluatorAssignment && context.intent) {
    await enqueueFollowOnIntent({
      db,
      operation: 'tasks.assignEvaluator',
      parent: context.intent,
      payload: {
        assignment: payload.evaluatorAssignment,
        payer: payload.payer,
        taskId,
      },
    });
  }

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

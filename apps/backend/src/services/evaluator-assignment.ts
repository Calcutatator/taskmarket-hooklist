// Implements: ADR-0045, ADR-0047
import { eq } from 'drizzle-orm';

import type { db as DbType } from '../db/client';
import { tasks } from '../db/schema';
import { contractAssignEvaluator } from './contract';
import { dispatchRelayedIntent } from './relayed-intent-registry';
import { recordRelayedIntent } from './relayed-intents';

type Db = typeof DbType;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

/** Contract defaults for the two windows, in hours, when a caller omits them. */
const DEFAULT_EVALUATION_WINDOW_HOURS = 24;
const DEFAULT_APPEAL_WINDOW_HOURS = 24;

/**
 * The five values `assignEvaluator` writes, normalised to the units the contract stores.
 *
 * Windows are seconds here and hours at every API boundary; the conversion happens once, in
 * `buildEvaluatorAssignment`, so the endpoint and task creation cannot disagree about what
 * "24" meant.
 */
export type EvaluatorAssignment = {
  appealWindow: number;
  disputeResolver: string | null;
  evaluationWindow: number;
  evaluator: string;
  evaluatorFeeBps: number;
};

/**
 * Everything the `tasks.assignEvaluator` intent needs, captured at request time.
 *
 * Persisted as jsonb, so it must stay plain and serializable: a reconciler pass in another
 * process may be the thing that reads it back and turns it into a transaction, with no request
 * context left to fall back on.
 */
export type TasksAssignEvaluatorIntentPayload = {
  assignment: EvaluatorAssignment;
  payer: string;
  taskId: string;
};

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/** A rejected assignment, carrying the HTTP status both callers need to report. */
export class EvaluatorAssignmentError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 = 400
  ) {
    super(message);
    this.name = 'EvaluatorAssignmentError';
  }
}

/**
 * Every reason an assignment cannot be made, checked in one place.
 *
 * Called twice on the REST path, and that is deliberate rather than redundant. The X402
 * preflight calls it *before* the payment settles, which is what stops a caller who is not the
 * requester -- or one whose task was claimed a moment ago -- paying the action fee for a call
 * that was never going to reach the chain; the same reason every other paid task action
 * validates in `services/task-action-preflight.ts`. The router calls it again after settlement
 * because the preflight is mounted on the Express route only, so a caller arriving through
 * tRPC would otherwise reach `runRelayedIntent` unchecked.
 *
 * The status and role rules mirror `EvaluatorFacet.assignEvaluator`, which is the actual
 * authority: it reverts `NotRequester`, `TaskNotOpen`, `InvalidEvaluator`,
 * `EvaluatorAlreadyAssigned` and `FeeBpsTooHigh`. Checking here does not replace those --
 * nothing off chain can -- it only turns a decoded revert into a readable refusal, and does so
 * before any money moves.
 */
export async function assertEvaluatorAssignable(input: {
  db: Db;
  disputeResolver?: string;
  evaluator: string;
  payer: string;
  taskId: string;
}): Promise<void> {
  if (!ADDRESS_PATTERN.test(input.evaluator)) {
    throw new EvaluatorAssignmentError('evaluator must be a wallet address');
  }
  // The contract rejects address(0) outright: an evaluator slot is also the "no evaluator"
  // sentinel, so assigning zero would claim to configure one while leaving the task unjudged.
  if (BigInt(input.evaluator) === 0n) {
    throw new EvaluatorAssignmentError('evaluator must not be the zero address');
  }
  if (input.disputeResolver !== undefined && !ADDRESS_PATTERN.test(input.disputeResolver)) {
    throw new EvaluatorAssignmentError('disputeResolver must be a wallet address');
  }

  const rows = await input.db
    .select({
      evaluator: tasks.evaluator,
      requester: tasks.requester,
      status: tasks.status,
    })
    .from(tasks)
    .where(eq(tasks.id, input.taskId))
    .limit(1);

  if (rows.length === 0) throw new EvaluatorAssignmentError('Task not found', 404);
  const task = rows[0];

  if (task.requester.toLowerCase() !== input.payer.toLowerCase()) {
    throw new EvaluatorAssignmentError('Only the task requester can assign an evaluator', 403);
  }
  if (task.status !== 'open') {
    throw new EvaluatorAssignmentError(
      'Task is not open -- an evaluator can only be assigned before work is claimed'
    );
  }
  if (task.evaluator) {
    throw new EvaluatorAssignmentError('Task already has an evaluator assigned');
  }
}

/** The hours-to-seconds normalisation both callers share. */
export function buildEvaluatorAssignment(input: {
  appealWindowHours?: number;
  disputeResolver?: string | null;
  evaluationWindowHours?: number;
  evaluator: string;
  evaluatorFeeBps?: number;
}): EvaluatorAssignment {
  return {
    appealWindow: Math.round((input.appealWindowHours ?? DEFAULT_APPEAL_WINDOW_HOURS) * 3600),
    disputeResolver: input.disputeResolver ?? null,
    evaluationWindow: Math.round(
      (input.evaluationWindowHours ?? DEFAULT_EVALUATION_WINDOW_HOURS) * 3600
    ),
    evaluator: input.evaluator,
    evaluatorFeeBps: input.evaluatorFeeBps ?? 0,
  };
}

/**
 * The one place `assignEvaluator` is encoded and relayed.
 *
 * Both the request path (which passes this to `runRelayedIntent`'s `send`) and the broadcast
 * path (which the reconciler and the crash-fallback worker use, from the persisted payload
 * alone) go through here, so an assignment sent hours later is byte-identical to one sent in
 * request. `stakeAmount` is fixed at 0: an evaluator stake would be pulled from the requester
 * by `transferFrom` inside the contract call, which needs a USDC approval the relay flow never
 * asks for, so no caller may currently request one.
 */
export function sendEvaluatorAssignment(
  payload: TasksAssignEvaluatorIntentPayload
): Promise<`0x${string}`> {
  const { assignment } = payload;
  return contractAssignEvaluator(
    payload.taskId as `0x${string}`,
    payload.payer as `0x${string}`,
    assignment.evaluator as `0x${string}`,
    0n,
    assignment.evaluatorFeeBps,
    assignment.evaluationWindow,
    assignment.appealWindow,
    (assignment.disputeResolver ?? ZERO_ADDRESS) as `0x${string}`
  );
}

/**
 * Mirror the confirmed on-chain assignment onto the task row.
 *
 * Idempotent by construction -- it writes the same five values from the same payload however
 * many times it runs, which is what lets a reconciler pass repeat it safely (ADR-0045).
 */
export async function completeEvaluatorAssignment(input: {
  db: Db;
  payload: TasksAssignEvaluatorIntentPayload;
}): Promise<void> {
  await input.db
    .update(tasks)
    .set(input.payload.assignment)
    .where(eq(tasks.id, input.payload.taskId));
}

/**
 * Record the assignment intent and get its transaction on chain, without ever throwing.
 *
 * This is the shape task creation needs and the endpoint does not. Creation reaches evaluator
 * assignment from a completion handler, at a point where the escrow is already confirmed and
 * the task exists: a throw there would make a creation that fully succeeded look incomplete,
 * and would leave the intent looking like something the caller should retry. So the outcome is
 * left entirely on the intent row -- `dispatchRelayedIntent` marks a deterministic revert
 * (`TaskNotOpen` for a task a worker claimed first) `failed` with the reason on it, which is
 * exactly the visible terminal state ADR-0047 asked for.
 *
 * Broadcast happens here and now rather than being handed to a poll. `assignEvaluator` is
 * gated on the task still being `Open`, and worker agents claim within milliseconds of
 * creation, so any deferral at all loses the race (ADR-0047 records 4 of 4 assignments lost to
 * exactly that).
 *
 * `idempotencyKey` is required rather than minted here, and required rather than optional,
 * because the only caller reaches this from an at-least-once completion handler: a key minted
 * per attempt would record a second intent and make a second `assignEvaluator` call on every
 * rerun (ADR-0052). There is no safe default for a caller that has not thought about what makes
 * its own retries the same request, so it has to say.
 */
export async function recordAndDispatchEvaluatorAssignment(input: {
  db: Db;
  idempotencyKey: string;
  payload: TasksAssignEvaluatorIntentPayload;
}): Promise<void> {
  const intent = await recordRelayedIntent({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
    operation: 'tasks.assignEvaluator',
    payer: input.payload.payer,
    payload: input.payload,
  });

  await dispatchRelayedIntent({ db: input.db, intent });
}

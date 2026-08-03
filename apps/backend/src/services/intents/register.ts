// Implements: ADR-0045
import { eq } from 'drizzle-orm';

import { tasks } from '../../db/schema';
import { contractAssignEvaluator } from '../contract';
import { registerRelayedIntentHandler } from '../relayed-intent-registry';
import { completeTasksCreate, type TasksCreateIntentPayload } from './tasks-create-intent';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

/**
 * The intent a task creation that carries an evaluator starts once its escrow is confirmed.
 * Assigning an evaluator is a second contract call -- the contract's createTask cannot take
 * evaluator configuration -- so it gets a durable record of its own before it is sent.
 */
export type TasksAssignEvaluatorIntentPayload = {
  assignment: {
    appealWindow: number;
    disputeResolver: string | null;
    evaluationWindow: number;
    evaluator: string;
    evaluatorFeeBps: number;
  };
  payer: string;
  taskId: string;
};

let registered = false;

/**
 * Bind every relayed-intent operation to the work that finishes it.
 *
 * Idempotent, and deliberately callable from more than one place: the reconciler needs the
 * handlers to exist in a process that may never have served the original request, and a
 * request path needs them to exist before the first call reaches it. Registering twice is a
 * no-op; registering too late is a silently unfinishable intent.
 */
export function registerRelayedIntentHandlers(): void {
  if (registered) return;
  registered = true;

  registerRelayedIntentHandler('tasks.create', async ({ db, intent, txHash }) => {
    const payload = intent.payload as TasksCreateIntentPayload;
    await completeTasksCreate({
      db,
      // The escrow hash cannot be in the payload: the intent is recorded before the chain
      // call, precisely so no transaction is ever live without a record. The confirmed hash
      // arrives here instead, from the request that broadcast it or from the reconciler.
      payload: { ...payload, escrowTxHash: payload.escrowTxHash || txHash },
    });
  });

  registerRelayedIntentHandler('tasks.assignEvaluator', {
    broadcast: async ({ intent }) => {
      const payload = intent.payload as TasksAssignEvaluatorIntentPayload;
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
    },
    complete: async ({ db, intent }) => {
      const payload = intent.payload as TasksAssignEvaluatorIntentPayload;
      await db.update(tasks).set(payload.assignment).where(eq(tasks.id, payload.taskId));
    },
  });
}

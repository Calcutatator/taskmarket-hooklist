// Implements: ADR-0045
import { eq } from 'drizzle-orm';

import { tasks } from '../../db/schema';
import { contractAssignEvaluator } from '../contract';
import { registerRelayedIntentHandler } from '../relayed-intent-registry';
import { completeTasksCreate, type TasksCreateIntentPayload } from './tasks-create-intent';
import {
  completeAcceptanceAccept,
  completeAcceptanceRate,
  type AcceptanceAcceptIntentPayload,
  type AcceptanceRateIntentPayload,
} from './acceptance-intents';
import {
  completeBidsAuctionAccept,
  completeBidsSubmit,
  type BidsAuctionAcceptIntentPayload,
  type BidsSubmitIntentPayload,
} from './bids-intents';
import {
  broadcastEvaluationsFinalizeVerdict,
  completeEvaluationsAppeal,
  completeEvaluationsEvaluate,
  completeEvaluationsEvaluatorTimeout,
  completeEvaluationsFinalizeVerdict,
  completeEvaluationsResolveDispute,
  type EvaluationsAppealIntentPayload,
  type EvaluationsEvaluateIntentPayload,
  type EvaluationsEvaluatorTimeoutIntentPayload,
  type EvaluationsFinalizeVerdictIntentPayload,
  type EvaluationsResolveDisputeIntentPayload,
} from './evaluations-intents';
import {
  broadcastClaimsClaim,
  broadcastClaimsForfeit,
  completeClaimsClaim,
  completeClaimsForfeit,
  type ClaimsClaimIntentPayload,
  type ClaimsForfeitIntentPayload,
} from './claims-intents';
import {
  broadcastIdentityRegister,
  completeIdentityRegister,
  type IdentityRegisterIntentPayload,
} from './identity-intents';
import {
  broadcastWalletWithdraw,
  broadcastWalletWithdrawDreams,
  completeWalletWithdraw,
  completeWalletWithdrawDreams,
  type WalletWithdrawDreamsIntentPayload,
  type WalletWithdrawIntentPayload,
} from './wallet-intents';
import {
  broadcastSubmissionsSubmit,
  completeSubmissionsSubmit,
  type SubmissionsSubmitIntentPayload,
} from './submissions-intents';
import {
  completePitchesSelect,
  completePitchesSubmit,
  type PitchesSelectIntentPayload,
  type PitchesSubmitIntentPayload,
} from './pitches-intents';
import {
  broadcastProofsAnchorDeliverable,
  completeProofsAnchorDeliverable,
  completeProofsSubmit,
  type ProofsAnchorDeliverableIntentPayload,
  type ProofsSubmitIntentPayload,
} from './proofs-intents';
import {
  completeTasksCancel,
  completeTasksRefundExpired,
  completeTasksRejectSubmission,
  completeTasksUpdate,
  type TasksCancelIntentPayload,
  type TasksRefundExpiredIntentPayload,
  type TasksRejectSubmissionIntentPayload,
  type TasksUpdateIntentPayload,
} from './tasks-mutation-intents';

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

  registerRelayedIntentHandler('tasks.update', async ({ db, intent }) =>
    completeTasksUpdate({ db, payload: intent.payload as TasksUpdateIntentPayload })
  );

  registerRelayedIntentHandler('tasks.cancel', async ({ db, intent }) =>
    completeTasksCancel({ db, payload: intent.payload as TasksCancelIntentPayload })
  );

  registerRelayedIntentHandler('tasks.refundExpired', async ({ db, intent }) =>
    completeTasksRefundExpired({
      db,
      payload: intent.payload as TasksRefundExpiredIntentPayload,
    })
  );

  registerRelayedIntentHandler('tasks.rejectSubmission', async ({ db, intent }) =>
    completeTasksRejectSubmission({
      db,
      payload: intent.payload as TasksRejectSubmissionIntentPayload,
    })
  );

  registerRelayedIntentHandler('acceptance.accept', async ({ db, intent }) =>
    completeAcceptanceAccept({ db, payload: intent.payload as AcceptanceAcceptIntentPayload })
  );

  // Deliberately empty. Accepting many submissions has no off-chain half at all: awards,
  // status and earnings are all derived by the indexer from the chain's own TaskCompleted
  // events. The intent still matters -- it is the record that makes the payment refundable on
  // a confirmed failure (ADR-0048), and inventing work here to fill the shape would be worse
  // than saying so.
  registerRelayedIntentHandler('acceptance.acceptSubmissions', async () => {});

  registerRelayedIntentHandler('acceptance.rate', async ({ db, intent, txHash }) =>
    completeAcceptanceRate({
      db,
      payload: intent.payload as AcceptanceRateIntentPayload,
      txHash: txHash as `0x${string}`,
    })
  );

  registerRelayedIntentHandler('bids.submit', async ({ db, intent }) =>
    completeBidsSubmit({ db, payload: intent.payload as BidsSubmitIntentPayload })
  );

  registerRelayedIntentHandler('bids.auctionAccept', async ({ db, intent }) =>
    completeBidsAuctionAccept({
      db,
      payload: intent.payload as BidsAuctionAcceptIntentPayload,
    })
  );

  registerRelayedIntentHandler('pitches.submit', async ({ db, intent, txHash }) =>
    completePitchesSubmit({
      db,
      payload: intent.payload as PitchesSubmitIntentPayload,
      txHash: txHash as `0x${string}`,
    })
  );

  registerRelayedIntentHandler('pitches.select', async ({ db, intent }) =>
    completePitchesSelect({ db, payload: intent.payload as PitchesSelectIntentPayload })
  );

  registerRelayedIntentHandler('proofs.submit', async ({ db, intent, txHash }) =>
    completeProofsSubmit({
      db,
      payload: intent.payload as ProofsSubmitIntentPayload,
      txHash: txHash as `0x${string}`,
    })
  );

  registerRelayedIntentHandler('proofs.anchorDeliverable', {
    broadcast: async ({ intent }) =>
      broadcastProofsAnchorDeliverable({
        payload: intent.payload as ProofsAnchorDeliverableIntentPayload,
      }),
    complete: async ({ db, intent, txHash }) =>
      completeProofsAnchorDeliverable({
        db,
        payload: intent.payload as ProofsAnchorDeliverableIntentPayload,
        txHash: txHash as `0x${string}`,
      }),
  });

  registerRelayedIntentHandler('evaluations.evaluate', async ({ db, intent, txHash }) =>
    completeEvaluationsEvaluate({
      db,
      payload: intent.payload as EvaluationsEvaluateIntentPayload,
      txHash: txHash as `0x${string}`,
    })
  );

  registerRelayedIntentHandler('evaluations.appeal', async ({ db, intent }) =>
    completeEvaluationsAppeal({ db, payload: intent.payload as EvaluationsAppealIntentPayload })
  );

  registerRelayedIntentHandler('evaluations.resolveDispute', async ({ db, intent, txHash }) =>
    completeEvaluationsResolveDispute({
      db,
      payload: intent.payload as EvaluationsResolveDisputeIntentPayload,
      txHash: txHash as `0x${string}`,
    })
  );

  registerRelayedIntentHandler('evaluations.evaluatorTimeout', async ({ db, intent }) =>
    completeEvaluationsEvaluatorTimeout({
      db,
      payload: intent.payload as EvaluationsEvaluatorTimeoutIntentPayload,
    })
  );

  registerRelayedIntentHandler('evaluations.finalizeVerdict', {
    broadcast: async ({ intent }) =>
      broadcastEvaluationsFinalizeVerdict({
        payload: intent.payload as EvaluationsFinalizeVerdictIntentPayload,
      }),
    complete: async ({ db, intent, txHash }) =>
      completeEvaluationsFinalizeVerdict({
        db,
        payload: intent.payload as EvaluationsFinalizeVerdictIntentPayload,
        txHash: txHash as `0x${string}`,
      }),
  });

  registerRelayedIntentHandler('claims.claim', {
    broadcast: async ({ intent }) =>
      broadcastClaimsClaim({ payload: intent.payload as ClaimsClaimIntentPayload }),
    complete: async ({ db, intent, txHash }) =>
      completeClaimsClaim({
        db,
        payload: intent.payload as ClaimsClaimIntentPayload,
        txHash: txHash as `0x${string}`,
      }),
  });

  registerRelayedIntentHandler('claims.forfeit', {
    broadcast: async ({ intent }) =>
      broadcastClaimsForfeit({ payload: intent.payload as ClaimsForfeitIntentPayload }),
    complete: async ({ db, intent }) =>
      completeClaimsForfeit({ db, payload: intent.payload as ClaimsForfeitIntentPayload }),
  });

  registerRelayedIntentHandler('submissions.submit', {
    broadcast: async ({ intent }) =>
      broadcastSubmissionsSubmit({ payload: intent.payload as SubmissionsSubmitIntentPayload }),
    complete: async ({ db, intent, txHash }) =>
      completeSubmissionsSubmit({
        db,
        payload: intent.payload as SubmissionsSubmitIntentPayload,
        txHash: txHash as `0x${string}`,
      }),
  });

  registerRelayedIntentHandler('wallet.withdraw', {
    broadcast: async ({ intent }) =>
      broadcastWalletWithdraw({ payload: intent.payload as WalletWithdrawIntentPayload }),
    complete: completeWalletWithdraw,
  });

  registerRelayedIntentHandler('wallet.withdrawDreams', {
    broadcast: async ({ intent }) =>
      broadcastWalletWithdrawDreams({
        payload: intent.payload as WalletWithdrawDreamsIntentPayload,
      }),
    complete: completeWalletWithdrawDreams,
  });

  registerRelayedIntentHandler('identity.register', {
    broadcast: async () => broadcastIdentityRegister(),
    complete: async ({ db, intent, txHash }) =>
      completeIdentityRegister({
        db,
        payload: intent.payload as IdentityRegisterIntentPayload,
        txHash: txHash as `0x${string}`,
      }),
  });
}

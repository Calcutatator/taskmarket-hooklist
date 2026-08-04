// Implements: ADR-0045, ADR-0050
import { eq } from 'drizzle-orm';

import { tasks } from '../../db/schema';
import { contractAssignEvaluator } from '../contract';
import { registerRelayedIntentHandler } from '../relayed-intent-registry';
import { completeTasksCreate, type TasksCreateIntentPayload } from './tasks-create-intent';
import {
  broadcastAcceptanceAccept,
  broadcastAcceptanceAcceptSubmissions,
  broadcastAcceptanceRate,
  completeAcceptanceAccept,
  completeAcceptanceRate,
  type AcceptanceAcceptIntentPayload,
  type AcceptanceAcceptSubmissionsIntentPayload,
  type AcceptanceRateIntentPayload,
} from './acceptance-intents';
import {
  broadcastBidsAuctionAccept,
  broadcastBidsSubmit,
  completeBidsAuctionAccept,
  completeBidsSubmit,
  type BidsAuctionAcceptIntentPayload,
  type BidsSubmitIntentPayload,
} from './bids-intents';
import {
  broadcastEvaluationsAppeal,
  broadcastEvaluationsEvaluate,
  broadcastEvaluationsEvaluatorTimeout,
  broadcastEvaluationsFinalizeVerdict,
  broadcastEvaluationsResolveDispute,
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
  releaseWalletWithdrawDreamsNonce,
  type WalletWithdrawDreamsIntentPayload,
  type WalletWithdrawIntentPayload,
} from './wallet-intents';
import {
  broadcastSubmissionsSubmit,
  completeSubmissionsSubmit,
  type SubmissionsSubmitIntentPayload,
} from './submissions-intents';
import {
  broadcastPitchesSelect,
  broadcastPitchesSubmit,
  completePitchesSelect,
  completePitchesSubmit,
  type PitchesSelectIntentPayload,
  type PitchesSubmitIntentPayload,
} from './pitches-intents';
import {
  broadcastProofsAnchorDeliverable,
  broadcastProofsSubmit,
  completeProofsAnchorDeliverable,
  completeProofsSubmit,
  type ProofsAnchorDeliverableIntentPayload,
  type ProofsSubmitIntentPayload,
} from './proofs-intents';
import {
  broadcastTasksCancel,
  broadcastTasksRejectSubmission,
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

  // ---------------------------------------------------------------------------------------
  // Operations with NO broadcaster, and why.
  //
  // ADR-0050 rebroadcasts an intent that provably never reached the chain rather than
  // refunding it, which needs a broadcaster: a way to turn the persisted jsonb payload back
  // into the same transaction, in a process that never served the original request. An
  // operation without one has its retry budget spent immediately by `dispatchRelayedIntent`
  // and drops to the refund path, which is the *old* behaviour and a strictly worse outcome
  // for the payer -- so the three exclusions below are deliberate, not oversights, and each is
  // excluded because replaying it verbatim would be wrong rather than merely unimplemented.
  //
  //   tasks.create      The payload's `taskId` is a prediction, not a fact. It comes from
  //                     `precomputeTaskId`, which reads the requester's on-chain nonce before
  //                     the call; `CoreFacet.createTask` derives the real id from
  //                     `requesterNonce[requester]++` at execution time. Between the failed
  //                     send and a rebroadcast, any other createTask by the same requester
  //                     consumes that nonce -- so the replay mints a *different* task while
  //                     the completion handler writes its row under the predicted id, which by
  //                     then belongs to someone else's task. `completeTasksCreate` upserts on
  //                     that id, so the write would overwrite a real task's description,
  //                     reward and tags. This is exactly ADR-0050's corollary: a payload that
  //                     would be actively wrong on replay is carrying the wrong thing. The fix
  //                     is for the id to come from the receipt's TaskCreated log instead of
  //                     from a prediction -- a change to `tasks-create-intent.ts` and the
  //                     completion's signature, not something a broadcaster can paper over.
  //                     Until then the escrow is also at stake: createTask relays with
  //                     `paymentAmount = reward`, so a duplicate funds escrow twice.
  //
  //   tasks.update      `contractUpdateTask` relays with `newReward - currentReward`, which the
  //                     forwarder moves out of the server wallet on every relay, while
  //                     `CoreFacet.updateTask` applies the reward change only when
  //                     `newReward != task.reward`. A replay therefore pays the increase again
  //                     and no-ops the change that justified it. The duplicate transfer is in
  //                     the forwarder, so no amount of payload can prevent it.
  //
  //   tasks.refundExpired
  //                     `CoreFacet.refundExpired` rejects Accepted and Cancelled but not
  //                     Expired -- the status it sets itself -- and never zeroes `task.reward`.
  //                     A second landing refunds the full reward again out of the pooled escrow
  //                     balance shared by every task. The only guard today is the router's own
  //                     database status check, which a rebroadcast does not run. Of everything
  //                     here this is the one operation whose replay the chain declines to stop,
  //                     so it is the one that must not be replayed.
  //
  // Everything else registers a broadcaster below, and each states the on-chain guard that
  // makes a second landing safe alongside it.
  // ---------------------------------------------------------------------------------------

  registerRelayedIntentHandler('tasks.create', async ({ db, intent, txHash }) => {
    const payload = intent.payload as TasksCreateIntentPayload;
    await completeTasksCreate({
      db,
      // The escrow hash cannot be in the payload: the intent is recorded before the chain
      // call, precisely so no transaction is ever live without a record. The confirmed hash
      // arrives here instead, from the request that broadcast it or from the reconciler.
      payload: { ...payload, escrowTxHash: payload.escrowTxHash || txHash },
      // The intent row's own creation time is the task's creation time: written before the
      // chain call, never rewritten, and identical on every completion attempt. That makes it
      // the anchor every deadline is derived from, rather than the clock at completion time.
      recordedAt: intent.createdAt,
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

  // Guard: cancelTask requires status Open and sets Cancelled, so its escrow refund is behind
  // a one-shot transition and a replay reverts TaskNotOpen.
  registerRelayedIntentHandler('tasks.cancel', {
    broadcast: async ({ intent }) =>
      broadcastTasksCancel({ payload: intent.payload as TasksCancelIntentPayload }),
    complete: async ({ db, intent }) =>
      completeTasksCancel({ db, payload: intent.payload as TasksCancelIntentPayload }),
  });

  registerRelayedIntentHandler('tasks.refundExpired', async ({ db, intent }) =>
    completeTasksRefundExpired({
      db,
      payload: intent.payload as TasksRefundExpiredIntentPayload,
    })
  );

  // Guard: taskRejectedWorkers[taskId][worker] is a one-shot flag, so a replay reverts
  // SubmissionAlreadyRejected and the active-submission count cannot be decremented twice.
  registerRelayedIntentHandler('tasks.rejectSubmission', {
    broadcast: async ({ intent }) =>
      broadcastTasksRejectSubmission({
        payload: intent.payload as TasksRejectSubmissionIntentPayload,
      }),
    complete: async ({ db, intent }) =>
      completeTasksRejectSubmission({
        db,
        payload: intent.payload as TasksRejectSubmissionIntentPayload,
      }),
  });

  // Guard: _validateAcceptSubmission requires a pre-acceptance status and success sets
  // Accepted, so the escrow payout happens once.
  registerRelayedIntentHandler('acceptance.accept', {
    broadcast: async ({ intent }) =>
      broadcastAcceptanceAccept({ payload: intent.payload as AcceptanceAcceptIntentPayload }),
    complete: async ({ db, intent }) =>
      completeAcceptanceAccept({ db, payload: intent.payload as AcceptanceAcceptIntentPayload }),
  });

  // Guard: same acceptance status gate as the single-winner path.
  //
  // The completion is deliberately empty. Accepting many submissions has no off-chain half at
  // all: awards, status and earnings are all derived by the indexer from the chain's own
  // TaskCompleted events. The intent still matters -- it is the record that makes the payment
  // refundable on a confirmed failure (ADR-0048), and now also what makes the acceptance
  // replayable rather than refundable (ADR-0050) -- and inventing completion work here to fill
  // the shape would be worse than saying so.
  registerRelayedIntentHandler('acceptance.acceptSubmissions', {
    broadcast: async ({ intent }) =>
      broadcastAcceptanceAcceptSubmissions({
        payload: intent.payload as AcceptanceAcceptSubmissionsIntentPayload,
      }),
    complete: async () => {},
  });

  // Guard: taskWorkerRated[taskId][worker] is a one-shot flag, so a replay reverts
  // WorkerAlreadyRated and cannot inflate the worker's star totals.
  registerRelayedIntentHandler('acceptance.rate', {
    broadcast: async ({ intent }) =>
      broadcastAcceptanceRate({ payload: intent.payload as AcceptanceRateIntentPayload }),
    complete: async ({ db, intent, txHash }) =>
      completeAcceptanceRate({
        db,
        payload: intent.payload as AcceptanceRateIntentPayload,
        txHash: txHash as `0x${string}`,
      }),
  });

  // Guard: no on-chain dedupe -- submitBid appends to taskBids -- so this relies on the
  // never-broadcast precondition. Safe because a duplicate moves no money and is inert: same
  // worker and price, the running minimum only moves on a strict `<`, and the bids row is
  // unique on (taskId, workerAddress). See broadcastBidsSubmit.
  registerRelayedIntentHandler('bids.submit', {
    broadcast: async ({ intent }) =>
      broadcastBidsSubmit({ payload: intent.payload as BidsSubmitIntentPayload }),
    complete: async ({ db, intent }) =>
      completeBidsSubmit({ db, payload: intent.payload as BidsSubmitIntentPayload }),
  });

  // Guard: acceptAuction requires Open and sets Claimed, so the task cannot be awarded twice.
  registerRelayedIntentHandler('bids.auctionAccept', {
    broadcast: async ({ intent }) =>
      broadcastBidsAuctionAccept({ payload: intent.payload as BidsAuctionAcceptIntentPayload }),
    complete: async ({ db, intent }) =>
      completeBidsAuctionAccept({
        db,
        payload: intent.payload as BidsAuctionAcceptIntentPayload,
      }),
  });

  // Guard: no on-chain dedupe -- submitPitch appends to taskPitchHashes -- so this relies on
  // the never-broadcast precondition, and a duplicate is inert for the same reasons as a bid.
  registerRelayedIntentHandler('pitches.submit', {
    broadcast: async ({ intent }) =>
      broadcastPitchesSubmit({ payload: intent.payload as PitchesSubmitIntentPayload }),
    complete: async ({ db, intent, txHash }) =>
      completePitchesSubmit({
        db,
        payload: intent.payload as PitchesSubmitIntentPayload,
        txHash: txHash as `0x${string}`,
      }),
  });

  // Guard: selectWorker requires Open and sets WorkerSelected, so a replay cannot reassign the
  // task to a different worker after the fact.
  registerRelayedIntentHandler('pitches.select', {
    broadcast: async ({ intent }) =>
      broadcastPitchesSelect({ payload: intent.payload as PitchesSelectIntentPayload }),
    complete: async ({ db, intent }) =>
      completePitchesSelect({ db, payload: intent.payload as PitchesSelectIntentPayload }),
  });

  // Guard: no on-chain dedupe -- submitProof appends to taskProofHashes -- so this relies on
  // the never-broadcast precondition, and a duplicate is inert for the same reasons as a bid.
  registerRelayedIntentHandler('proofs.submit', {
    broadcast: async ({ intent }) =>
      broadcastProofsSubmit({ payload: intent.payload as ProofsSubmitIntentPayload }),
    complete: async ({ db, intent, txHash }) =>
      completeProofsSubmit({
        db,
        payload: intent.payload as ProofsSubmitIntentPayload,
        txHash: txHash as `0x${string}`,
      }),
  });

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

  // The evaluator, appellant, resolver and requester are all the intent's own `payer`: each
  // router established that identity against the task before recording, and the intent row is
  // where that finding survives the request. `pitches.select` is the one operation where the
  // payer and the on-chain sender differ, and it carries the sender in its payload instead.

  // Guard: evaluate requires Review (or Open/PendingApproval in the contest modes) and leaves
  // the task Appealing, so a replay reverts WrongStatusForEvaluation.
  registerRelayedIntentHandler('evaluations.evaluate', {
    broadcast: async ({ intent }) =>
      broadcastEvaluationsEvaluate({
        evaluator: intent.payer as string,
        payload: intent.payload as EvaluationsEvaluateIntentPayload,
      }),
    complete: async ({ db, intent, txHash }) =>
      completeEvaluationsEvaluate({
        db,
        payload: intent.payload as EvaluationsEvaluateIntentPayload,
        txHash: txHash as `0x${string}`,
      }),
  });

  // Guard: appeal requires Appealing and sets Disputed, so a replay reverts
  // NotInAppealingState.
  registerRelayedIntentHandler('evaluations.appeal', {
    broadcast: async ({ intent }) =>
      broadcastEvaluationsAppeal({
        payload: intent.payload as EvaluationsAppealIntentPayload,
        worker: intent.payer as string,
      }),
    complete: async ({ db, intent }) =>
      completeEvaluationsAppeal({ db, payload: intent.payload as EvaluationsAppealIntentPayload }),
  });

  // Guard: resolveDispute requires Disputed and settles the task out of it, so the payout
  // cannot run twice -- a replay reverts NotInDisputedState.
  registerRelayedIntentHandler('evaluations.resolveDispute', {
    broadcast: async ({ intent }) =>
      broadcastEvaluationsResolveDispute({
        payload: intent.payload as EvaluationsResolveDisputeIntentPayload,
        resolver: intent.payer as string,
      }),
    complete: async ({ db, intent, txHash }) =>
      completeEvaluationsResolveDispute({
        db,
        payload: intent.payload as EvaluationsResolveDisputeIntentPayload,
        txHash: txHash as `0x${string}`,
      }),
  });

  // Guard: evaluatorTimeout requires Review and sets PendingApproval, zeroing the evaluator
  // stake in the same transition, so the forfeiture happens once.
  registerRelayedIntentHandler('evaluations.evaluatorTimeout', {
    broadcast: async ({ intent }) =>
      broadcastEvaluationsEvaluatorTimeout({
        payload: intent.payload as EvaluationsEvaluatorTimeoutIntentPayload,
        requester: intent.payer as string,
      }),
    complete: async ({ db, intent }) =>
      completeEvaluationsEvaluatorTimeout({
        db,
        payload: intent.payload as EvaluationsEvaluatorTimeoutIntentPayload,
      }),
  });

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
    // The replay nonce the router claimed before the chain call. Declared here, next to the
    // broadcast that spends it, so the release is driven by the intent reaching `failed` on
    // chain evidence rather than by whatever the request's send happened to throw (ADR-0050).
    releaseGuard: async ({ db, intent }) =>
      releaseWalletWithdrawDreamsNonce({
        db,
        nonce: (intent.payload as WalletWithdrawDreamsIntentPayload).nonce,
      }),
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

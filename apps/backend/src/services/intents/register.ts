// Implements: ADR-0045
// Implements: ADR-0050
// Implements: ADR-0055
// The assignEvaluator encoder and completion are imported rather than written inline here:
// POST /api/tasks/{taskId}/evaluator and task creation both reach the same intent operation, so
// the broadcast path this file registers has to be the one they already use (ADR-0047).
import {
  completeEvaluatorAssignment,
  sendEvaluatorAssignment,
  type TasksAssignEvaluatorIntentPayload,
} from '../evaluator-assignment';
import { registerRelayedIntentHandler } from '../relayed-intent-registry';
import {
  broadcastTasksCreate,
  completeTasksCreate,
  type TasksCreateIntentPayload,
} from './tasks-create-intent';
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
  broadcastTasksRefundExpired,
  broadcastTasksRejectSubmission,
  broadcastTasksUpdate,
  completeTasksCancel,
  completeTasksRefundExpired,
  completeTasksRejectSubmission,
  completeTasksUpdate,
  type TasksCancelIntentPayload,
  type TasksRefundExpiredIntentPayload,
  type TasksRejectSubmissionIntentPayload,
  type TasksUpdateIntentPayload,
} from './tasks-mutation-intents';

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

  // Every operation below registers a broadcaster, and each states the on-chain guard that
  // makes a second landing safe alongside it. There is no exemption list: an operation that
  // cannot be rebroadcast has its retry budget spent immediately by `dispatchRelayedIntent`
  // and drops to the refund path, which is the outcome ADR-0050 exists to remove.

  registerRelayedIntentHandler('tasks.create', {
    // Every other safely-replayable operation has a broadcaster; this one was the exception
    // only because the request had already predicted a task id, and a rebroadcast landing at
    // a different requester nonce would have named a different task. Nothing predicts an id
    // any more -- the completion reads it from whichever transaction actually confirmed -- so
    // a rebroadcast is now the same replay as any other. The guard against a second landing
    // is the forwarder's consumed-receipt map; see broadcastTasksCreate.
    broadcast: async ({ intent }) =>
      broadcastTasksCreate({
        payload: intent.payload as TasksCreateIntentPayload,
        // The x402 payment this creation's escrow is funded by, replayed from the intent row
        // rather than the payload: it is the settled payment reference the intent already
        // carries, and contractCreateTask waits on its receipt before relaying.
        paymentTxHash: (intent.paymentTxHash as `0x${string}` | null) ?? null,
      }),
    complete: async ({ db, intent, txHash }) =>
      completeTasksCreate({
        db,
        payload: intent.payload as TasksCreateIntentPayload,
        // The intent row's own creation time is the task's creation time: written before the
        // chain call, never rewritten, and identical on every completion attempt. That makes
        // it the anchor every deadline is derived from, rather than the clock at completion.
        recordedAt: intent.createdAt,
        // Neither the escrow hash nor the task id can be in the payload: the intent is
        // recorded before the chain call, precisely so no transaction is ever live without a
        // record. Both are read from the confirmed transaction here, by whichever of the
        // request or the reconciler observed it.
        txHash: txHash as `0x${string}`,
      }),
  });

  // Implements: ADR-0047 -- a root intent of its own, whose caller is now only
  // POST /api/tasks/{taskId}/evaluator.
  //
  // Task creation no longer uses this. It passes the evaluator terms to createTask and has
  // them applied in the same transaction, which is the only configuration that cannot lose
  // the race against a worker claiming -- ADR-0047 named the contract API gap, and rev016
  // closed it. What this replaces was a second call dispatched from the creation completion,
  // racing a claim it usually but not always beat.
  //
  // The operation stays registered because appointing an evaluator to an already-live task is
  // real and permanent: a requester who decides on one after creating has no other route, and
  // the contract's Open gate correctly bounds it to a task nobody has claimed. Broadcast and
  // completion go through the shared evaluator-assignment service, so an assignment the
  // crash-fallback worker picks up from jsonb hours later is the identical contract call.
  registerRelayedIntentHandler('tasks.assignEvaluator', {
    broadcast: async ({ intent }) =>
      sendEvaluatorAssignment(intent.payload as TasksAssignEvaluatorIntentPayload),
    complete: async ({ db, intent }) =>
      completeEvaluatorAssignment({
        db,
        payload: intent.payload as TasksAssignEvaluatorIntentPayload,
      }),
  });

  // Guard: a replay that names a reward reverts NoRewardChange -- ADR-0054 made updateTask
  // revert rather than silently no-op when a named reward equals the current one, which is what
  // unwinds the delta the forwarder pulled before the Diamond ran. A replay that names no reward
  // relays paymentAmount 0 and re-assigns the same recorded deadlines, so it moves nothing.
  registerRelayedIntentHandler('tasks.update', {
    broadcast: async ({ intent }) =>
      broadcastTasksUpdate({
        payer: intent.payer as string,
        payload: intent.payload as TasksUpdateIntentPayload,
      }),
    complete: async ({ db, intent }) =>
      completeTasksUpdate({ db, payload: intent.payload as TasksUpdateIntentPayload }),
  });

  // Guard: cancelTask requires status Open and sets Cancelled, so its escrow refund is behind
  // a one-shot transition and a replay reverts TaskNotOpen.
  registerRelayedIntentHandler('tasks.cancel', {
    broadcast: async ({ intent }) =>
      broadcastTasksCancel({ payload: intent.payload as TasksCancelIntentPayload }),
    complete: async ({ db, intent }) =>
      completeTasksCancel({ db, payload: intent.payload as TasksCancelIntentPayload }),
  });

  // Guard: a second landing reverts TaskAlreadyRefunded -- ADR-0054 made refundExpired treat the
  // Expired status it sets itself as terminal, and zero `task.reward` before transferring, so
  // the pooled escrow every task shares cannot be paid out twice for one expiry. Permissionless
  // (ADR-0026) and single-shot are orthogonal; it was only ever the second one that was missing.
  registerRelayedIntentHandler('tasks.refundExpired', {
    broadcast: async ({ intent }) =>
      broadcastTasksRefundExpired({
        payer: intent.payer as string,
        payload: intent.payload as TasksRefundExpiredIntentPayload,
      }),
    complete: async ({ db, intent }) =>
      completeTasksRefundExpired({
        db,
        payload: intent.payload as TasksRefundExpiredIntentPayload,
      }),
  });

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

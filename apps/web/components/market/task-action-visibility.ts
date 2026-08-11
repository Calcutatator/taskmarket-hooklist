import type { PendingAction } from '@taskmarket/shared';

export function sameAddress(left?: string | null, right?: string | null) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

export type ActionVisibilityParams = {
  action: PendingAction;
  address?: string;
  claimedBy?: string | null;
  disputeResolver?: string | null;
  evidenceReady?: boolean;
  evaluator?: string | null;
  requester: string;
  worker?: string | null;
};

export function canViewAction({
  action,
  address,
  claimedBy,
  disputeResolver,
  evidenceReady,
  evaluator,
  requester,
  worker,
}: ActionVisibilityParams) {
  // Evaluation and dispute resolution require inspecting the complete evidence
  // set. `evidenceReady` is established only after the caller-scoped evidence
  // request succeeds; visibility mode alone must never imply that evidence loaded.
  if (
    (action.action === 'evaluate' || action.action === 'resolve_dispute') &&
    evidenceReady !== true
  ) {
    return false;
  }

  if (action.role === 'anyone') {
    return true;
  }

  if (action.eligibleAddress) {
    return sameAddress(address, action.eligibleAddress);
  }

  if (action.role === 'requester') {
    return sameAddress(address, requester);
  }

  if (action.role === 'evaluator') {
    return sameAddress(address, evaluator);
  }

  if (action.role === 'dispute_resolver') {
    return sameAddress(address, disputeResolver);
  }

  if (sameAddress(address, requester)) {
    return false;
  }

  // Contest appeals without a lead award are projected per authenticated
  // submitter. An unscoped appeal must never become visible to every wallet.
  if (action.action === 'appeal') {
    return false;
  }

  const assignedWorker = worker ?? claimedBy;
  if (assignedWorker) {
    return sameAddress(address, assignedWorker);
  }

  return true;
}

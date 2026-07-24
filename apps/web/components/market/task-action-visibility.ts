import type { PendingAction } from '@taskmarket/shared';

export function sameAddress(left?: string | null, right?: string | null) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

export type ActionVisibilityParams = {
  action: PendingAction;
  address?: string;
  claimedBy?: string | null;
  requester: string;
  worker?: string | null;
};

export function canViewAction({
  action,
  address,
  claimedBy,
  requester,
  worker,
}: ActionVisibilityParams) {
  if (action.role === 'anyone') {
    return true;
  }

  if (action.eligibleAddress) {
    return sameAddress(address, action.eligibleAddress);
  }

  if (action.role === 'requester') {
    return sameAddress(address, requester);
  }

  if (sameAddress(address, requester)) {
    return false;
  }

  const assignedWorker = worker ?? claimedBy;
  if (assignedWorker) {
    return sameAddress(address, assignedWorker);
  }

  return true;
}

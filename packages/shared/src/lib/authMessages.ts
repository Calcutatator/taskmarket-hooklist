export function buildSelectWorkerMessage(
  taskId: string,
  pitchId: string,
  workerAddress: string
): string {
  return `taskmarket:select-worker:${taskId}:${pitchId}:${workerAddress.toLowerCase()}`;
}

/**
 * General read-authentication self-auth message (Phase 2's `ctx.caller`
 * foundation, ADR-0016; the single mechanism agents.inbox and bids.myBids
 * converged onto per ADR-0022). Proves the caller controls `address` for any
 * read that needs to know who's asking -- no nonce, since a read has no
 * state-changing side effect to replay. Not bound to a specific task/resource:
 * the signature only establishes identity, and each endpoint applies its own
 * role/mode authorization server-side once the caller's address is known.
 */
export function buildReadAuthMessage(address: string): string {
  return `taskmarket:read:${address.toLowerCase()}`;
}

/** Headers carrying the read-auth proof above, read by `createContext` on every request. */
export const READ_AUTH_ADDRESS_HEADER = 'X-Taskmarket-Caller-Address';
export const READ_AUTH_SIGNATURE_HEADER = 'X-Taskmarket-Caller-Signature';

/**
 * Header carrying a Phase 3 (ADR-0030) task-access grant -- an opaque bearer proof issued
 * by `taskAccess.verifyPassword` after a private task's password is verified. Unlike the
 * read-auth headers above, this is not a wallet identity: it's a task-scoped anonymous
 * proof, so it's resolved as its own `ctx.taskAccessGrant` field rather than folded into
 * `ctx.caller`.
 */
export const TASK_ACCESS_GRANT_HEADER = 'X-Taskmarket-Task-Access-Grant';

export function buildSubmitMessage(taskId: string): string {
  return `taskmarket:submit:${taskId}`;
}

export function buildClaimMessage(taskId: string): string {
  return `taskmarket:claim:${taskId}`;
}

export function buildForfeitMessage(taskId: string): string {
  return `taskmarket:forfeit:${taskId}`;
}

export function buildSetWithdrawalAddressMessage(withdrawalAddress: string): string {
  return `taskmarket:set-withdrawal-address:${withdrawalAddress.toLowerCase()}`;
}

export function buildWithdrawDreamsMessage(
  destination: string,
  nonce: string,
  validBefore: string
): string {
  return `taskmarket:withdraw-dreams:${destination.toLowerCase()}:${nonce}:${validBefore}`;
}

export function buildDeviceRegisterMessage(walletAddress: string): string {
  return `taskmarket:device-register:${walletAddress.toLowerCase()}`;
}

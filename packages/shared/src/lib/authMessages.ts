export function buildSelectWorkerMessage(
  taskId: string,
  pitchId: string,
  workerAddress: string
): string {
  return `taskmarket:select-worker:${taskId}:${pitchId}:${workerAddress.toLowerCase()}`;
}

export function buildInboxSelfAuthMessage(address: string): string {
  return `taskmarket:inbox:${address}`;
}

export function buildMyBidsMessage(address: string): string {
  return `taskmarket:my-bids:${address}`;
}

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
  return `taskmarket:set-withdrawal-address:${withdrawalAddress}`;
}

export function buildWithdrawDreamsMessage(
  destination: string,
  nonce: string,
  validBefore: string
): string {
  return `taskmarket:withdraw-dreams:${destination}:${nonce}:${validBefore}`;
}

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

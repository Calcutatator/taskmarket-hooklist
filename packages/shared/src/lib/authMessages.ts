export function buildSelectWorkerMessage(
  taskId: string,
  pitchId: string,
  workerAddress: string
): string {
  return `taskmarket:select-worker:${taskId}:${pitchId}:${workerAddress.toLowerCase()}`;
}

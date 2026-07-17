/**
 * Persist a range checkpoint only after every event in that range succeeds.
 * Settlement projection errors must remain retryable on the next poll.
 */
export async function runCheckpointedRange(
  fromBlock: bigint,
  toBlock: bigint,
  processRange: (fromBlock: bigint, toBlock: bigint) => Promise<void>,
  saveCheckpoint: (blockNumber: bigint) => Promise<void>
): Promise<void> {
  await processRange(fromBlock, toBlock);
  await saveCheckpoint(toBlock);
}

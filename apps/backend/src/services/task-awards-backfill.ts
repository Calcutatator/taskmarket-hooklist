export type ResumableTaskAwardsBackfillOptions = {
  chunkSize: bigint;
  endBlock: bigint;
  loadCheckpoint: () => Promise<bigint | null>;
  processRange: (fromBlock: bigint, toBlock: bigint) => Promise<void>;
  saveCheckpoint: (blockNumber: bigint) => Promise<void>;
  startBlock: bigint;
};

export type TaskAwardsBackfillOptions = {
  chainId: number;
  chunkSize: bigint;
  contractAddress: string;
  getLatestBlock: () => Promise<bigint>;
  loadCheckpoint: (checkpointId: string) => Promise<bigint | null>;
  processRange: (fromBlock: bigint, toBlock: bigint) => Promise<void>;
  saveCheckpoint: (checkpointId: string, blockNumber: bigint) => Promise<void>;
  startBlock: bigint;
  validate: () => Promise<void>;
};

type TaskSettlementState = {
  verdictAwards: Array<{ amount: bigint }>;
  verdictIssued: boolean;
};

/**
 * Separate valid evaluator completions with no positive payouts from tasks
 * whose expected settlement events are missing.
 */
export async function findUnresolvedTaskAwardIds(
  taskIds: string[],
  loadSettlementState: (taskId: string) => Promise<TaskSettlementState>
): Promise<string[]> {
  const unresolved: string[] = [];
  for (const taskId of taskIds) {
    const state = await loadSettlementState(taskId);
    const isNoPayoutVerdict =
      state.verdictIssued && state.verdictAwards.every((award) => award.amount <= 0n);
    if (!isNoPayoutVerdict) unresolved.push(taskId);
  }
  return unresolved;
}

export function taskAwardsBackfillCheckpointId(chainId: number, contractAddress: string): string {
  return `task_awards_backfill:${chainId}:${contractAddress.toLowerCase()}`;
}

/**
 * Process historical award events in durable chunks. A checkpoint is saved
 * only after its range succeeds, so retries restart at the first incomplete
 * range while idempotent projections absorb any partial writes.
 */
export async function runResumableTaskAwardsBackfill(
  options: ResumableTaskAwardsBackfillOptions
): Promise<void> {
  if (options.chunkSize <= 0n) {
    throw new Error('Task awards backfill chunk size must be positive');
  }

  const checkpoint = await options.loadCheckpoint();
  let fromBlock =
    checkpoint === null || checkpoint < options.startBlock ? options.startBlock : checkpoint + 1n;

  while (fromBlock <= options.endBlock) {
    const rangeEnd = fromBlock + options.chunkSize - 1n;
    const toBlock = rangeEnd < options.endBlock ? rangeEnd : options.endBlock;
    await options.processRange(fromBlock, toBlock);
    await options.saveCheckpoint(toBlock);
    fromBlock = toBlock + 1n;
  }
}

/** Run the chain-scoped backfill through a captured head, then verify its result. */
export async function runTaskAwardsBackfill(options: TaskAwardsBackfillOptions): Promise<void> {
  const checkpointId = taskAwardsBackfillCheckpointId(options.chainId, options.contractAddress);
  const endBlock = await options.getLatestBlock();
  if (options.startBlock > endBlock) {
    throw new Error(
      `Task awards backfill start block ${options.startBlock} exceeds end block ${endBlock}`
    );
  }

  await runResumableTaskAwardsBackfill({
    chunkSize: options.chunkSize,
    endBlock,
    loadCheckpoint: () => options.loadCheckpoint(checkpointId),
    processRange: options.processRange,
    saveCheckpoint: (blockNumber) => options.saveCheckpoint(checkpointId, blockNumber),
    startBlock: options.startBlock,
  });
  await options.validate();
}

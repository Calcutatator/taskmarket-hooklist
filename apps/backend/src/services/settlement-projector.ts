export type SettlementCompletionLog = {
  args: {
    taskId: string;
    worker: string;
    workerPayment: bigint;
    platformFee: bigint;
  };
  blockNumber: bigint;
  logIndex: number;
  transactionHash: string;
};

export type EventLog = {
  args: Record<string, unknown>;
  eventName: string;
  blockNumber?: bigint | null;
  logIndex?: number | null;
  transactionHash?: `0x${string}` | null;
};

export function toSettlementCompletionLogs(logs: EventLog[]): SettlementCompletionLog[] {
  return logs.flatMap((log) => {
    if (
      log.eventName !== 'TaskCompleted' ||
      log.blockNumber == null ||
      log.logIndex == null ||
      !log.transactionHash
    ) {
      return [];
    }

    const { taskId, worker, workerPayment, platformFee } = log.args;
    if (
      typeof taskId !== 'string' ||
      typeof worker !== 'string' ||
      typeof workerPayment !== 'bigint' ||
      typeof platformFee !== 'bigint'
    ) {
      throw new Error(`Invalid TaskCompleted log at ${log.blockNumber}:${log.logIndex}`);
    }

    return [
      {
        args: { platformFee, taskId, worker, workerPayment },
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
        transactionHash: log.transactionHash,
      },
    ];
  });
}

export type SettlementVerdictAward = {
  worker: string;
  amount: bigint;
  rank: number;
};

export type SettlementChainState = {
  primaryWorker: string | null;
  verdictIssued: boolean;
  verdictAwards: SettlementVerdictAward[];
};

export type ProjectedTaskAward = {
  blockNumber: bigint;
  grossAmount: bigint;
  isPrimary: boolean;
  logIndex: number;
  platformFee: bigint;
  rank: number;
  workerAddress: string;
  workerPayment: bigint;
};

export type ProjectedSettlement = {
  awards: ProjectedTaskAward[];
  blockNumber: bigint;
  primaryWorker: string | null;
  taskId: string;
  transactionHash: string;
};

function sameAddress(left: string | null | undefined, right: string | null | undefined): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function settlementKey(log: SettlementCompletionLog): string {
  return `${log.transactionHash.toLowerCase()}:${log.args.taskId.toLowerCase()}`;
}

function matchingVerdictRank(
  award: ProjectedTaskAward,
  verdictAward: SettlementVerdictAward | undefined
): number | null {
  if (!verdictAward) return null;
  if (!sameAddress(award.workerAddress, verdictAward.worker)) return null;
  if (award.grossAmount !== verdictAward.amount) return null;
  return verdictAward.rank;
}

/**
 * Convert the one-TaskCompleted-event-per-recipient contract stream into one
 * settlement containing every paid award. Direct acceptance ranks are event
 * order; evaluator/dispute ranks come from the stored verdict when it matches.
 */
export function projectSettlementLogs(
  logs: SettlementCompletionLog[],
  chainStateByTaskId: ReadonlyMap<string, SettlementChainState>
): ProjectedSettlement[] {
  const groups = new Map<string, SettlementCompletionLog[]>();
  const orderedLogs = logs
    .slice()
    .sort((left, right) =>
      left.blockNumber === right.blockNumber
        ? left.logIndex - right.logIndex
        : left.blockNumber < right.blockNumber
          ? -1
          : 1
    );

  for (const log of orderedLogs) {
    const key = settlementKey(log);
    const group = groups.get(key) ?? [];
    group.push(log);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const first = group[0]!;
    const taskId = first.args.taskId;
    const chainState =
      chainStateByTaskId.get(taskId) ?? chainStateByTaskId.get(taskId.toLowerCase()) ?? null;
    const verdictAwards = chainState?.verdictIssued
      ? chainState.verdictAwards.filter((award) => award.amount > 0n)
      : [];

    let primaryAssigned = false;
    const awards = group.map((log, index) => {
      const isPrimary = !primaryAssigned && sameAddress(log.args.worker, chainState?.primaryWorker);
      if (isPrimary) primaryAssigned = true;
      const projected: ProjectedTaskAward = {
        blockNumber: log.blockNumber,
        grossAmount: log.args.workerPayment + log.args.platformFee,
        isPrimary,
        logIndex: log.logIndex,
        platformFee: log.args.platformFee,
        rank: index + 1,
        workerAddress: log.args.worker,
        workerPayment: log.args.workerPayment,
      };
      projected.rank = matchingVerdictRank(projected, verdictAwards[index]) ?? projected.rank;
      return projected;
    });

    return {
      awards,
      blockNumber: first.blockNumber,
      primaryWorker: chainState?.primaryWorker ?? awards[0]?.workerAddress ?? null,
      taskId,
      transactionHash: first.transactionHash,
    };
  });
}

import { and, eq, isNull, or } from 'drizzle-orm';
import { createPublicClient, decodeEventLog, getAddress, http, parseAbiItem } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { getServerConfig } from '../config/env';
import { db } from '../db/client';
import { tasks } from '../db/schema';

const TASK_CREATED_EVENT = parseAbiItem(
  'event TaskCreated(bytes32 indexed taskId, address indexed requester, uint256 reward, bytes4 indexed mode, uint256 expiryTime)'
);

export type ContractAddressBackfillSummary = {
  candidates: number;
  repaired: number;
  unresolved: string[];
};

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  attempts: number,
  baseDelayMs: number
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

/**
 * Recovers tasks.contract_address from each task's own escrow transaction
 * receipt, for any task where it was never recorded. Ground truth per task
 * (which contract actually created it) rather than a guess -- see ADR-0008.
 * Read-only against the chain; only writes tasks.contract_address, and only
 * for the exact address the task's own TaskCreated log resolves to.
 */
export async function runContractAddressBackfill(): Promise<ContractAddressBackfillSummary> {
  const config = getServerConfig();
  const client = createPublicClient({
    chain: config.CHAIN_ID === 84532 ? baseSepolia : base,
    transport: http(config.BASE_RPC_URL),
  });

  const candidates = await db
    .select({ id: tasks.id, escrowTxHash: tasks.escrowTxHash })
    .from(tasks)
    .where(or(isNull(tasks.contractAddress), eq(tasks.contractAddress, '')));

  let repaired = 0;
  const unresolved: string[] = [];

  for (const task of candidates) {
    try {
      const receipt = await retryWithBackoff(
        () => client.getTransactionReceipt({ hash: task.escrowTxHash as `0x${string}` }),
        3,
        500
      );

      const createdLog = receipt.logs.find((log) => {
        try {
          const decoded = decodeEventLog({
            abi: [TASK_CREATED_EVENT],
            data: log.data,
            topics: log.topics,
          });
          return decoded.eventName === 'TaskCreated' && decoded.args.taskId === task.id;
        } catch {
          return false;
        }
      });

      if (!createdLog) {
        unresolved.push(task.id);
        continue;
      }

      await db
        .update(tasks)
        // Checksummed (EIP-55 mixed-case) to match the format the rest of the
        // app writes -- viem returns raw RPC log addresses as lowercase, and
        // leaving that as-is splits the same contract into two distinct
        // string values in a plain group-by/count (every real comparison in
        // this codebase already normalizes via lower(), so this is a
        // cleanliness fix, not a correctness one).
        .set({ contractAddress: getAddress(createdLog.address) })
        .where(
          and(
            eq(tasks.id, task.id),
            or(isNull(tasks.contractAddress), eq(tasks.contractAddress, ''))
          )
        );
      repaired += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`Contract address backfill: task ${task.id} failed -- ${reason}`);
      unresolved.push(task.id);
    }
  }

  const summary = { candidates: candidates.length, repaired, unresolved };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

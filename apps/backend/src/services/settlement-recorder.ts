import { eq, sql } from 'drizzle-orm';
import type { db } from '../db/client';
import { agents, indexedEvents, platformFees, taskAwards, tasks } from '../db/schema';
import type { ProjectedSettlement } from './settlement-projector';

type Database = Pick<typeof db, 'transaction'>;

export type RecordTaskSettlementInput = {
  chainId: number;
  settledAt: Date;
  settlement: ProjectedSettlement;
};

// Implements: ADR-0006 (task_awards is the sole post-completion source of truth)
// The one write path for a completed task's award(s) -- called from both the indexer's
// TaskCompleted handling and, synchronously, from evaluations.router.ts's
// resolveDispute/finalizeVerdict approve path, closing the eventual-consistency window
// where a task could flip to status='completed' before any task_awards row existed.
/**
 * Persist one on-chain settlement and apply its accounting side effects once.
 * Event markers are claimed in the same transaction before any increments so
 * concurrent indexers cannot both account for the same payout.
 */
export async function recordTaskSettlement(
  database: Database,
  input: RecordTaskSettlementInput
): Promise<void> {
  const { chainId, settledAt, settlement } = input;

  await database.transaction(async (tx) => {
    const claimedEvents = await tx
      .insert(indexedEvents)
      .values(
        settlement.awards.map((award) => ({
          blockNumber: award.blockNumber,
          chainId,
          eventName: 'TaskCompleted',
          logIndex: award.logIndex,
          txHash: settlement.transactionHash,
        }))
      )
      .onConflictDoNothing()
      .returning({ logIndex: indexedEvents.logIndex });
    const claimedLogIndexes = new Set(claimedEvents.map((event) => event.logIndex));

    await tx
      .insert(taskAwards)
      .values(
        settlement.awards.map((award) => ({
          blockNumber: award.blockNumber,
          chainId,
          logIndex: award.logIndex,
          platformFee: award.platformFee.toString(),
          rank: award.rank,
          settledAt,
          settlementTxHash: settlement.transactionHash,
          taskId: settlement.taskId,
          workerAddress: award.workerAddress.toLowerCase(),
          workerPayment: award.workerPayment.toString(),
        }))
      )
      .onConflictDoNothing();

    await tx.update(tasks).set({ status: 'completed' }).where(eq(tasks.id, settlement.taskId));

    const taskRow = await tx
      .select({ tags: tasks.tags })
      .from(tasks)
      .where(eq(tasks.id, settlement.taskId))
      .limit(1);
    const tags = taskRow[0]?.tags ?? [];
    const skillsExpr =
      tags.length === 0
        ? sql`ARRAY[]::text[]`
        : sql`ARRAY(SELECT DISTINCT unnest(ARRAY[${sql.join(
            tags.map((tag) => sql`${tag}`),
            sql`, `
          )}]))`;
    const claimedAwards = settlement.awards.filter((award) =>
      claimedLogIndexes.has(award.logIndex)
    );

    for (const award of claimedAwards) {
      if (award.platformFee > 0n) {
        await tx.insert(platformFees).values({
          amount: award.platformFee.toString(),
          taskId: settlement.taskId,
          txHash: settlement.transactionHash,
        });
      }
    }

    const earningsByWorker = new Map<string, { amount: bigint; awardCount: number }>();
    for (const award of claimedAwards) {
      if (award.workerPayment <= 0n) continue;
      const address = award.workerAddress.toLowerCase();
      const current = earningsByWorker.get(address);
      earningsByWorker.set(address, {
        amount: (current?.amount ?? 0n) + award.workerPayment,
        awardCount: (current?.awardCount ?? 0) + 1,
      });
    }

    for (const [address, earnings] of earningsByWorker) {
      const agentUpdates = {
        completedTasks: sql`${agents.completedTasks} + ${earnings.awardCount}`,
        skills: sql`ARRAY(SELECT DISTINCT unnest(${agents.skills} || ${skillsExpr}))`,
        totalEarnings: sql`${agents.totalEarnings} + ${earnings.amount.toString()}`,
        updatedAt: new Date(),
      };
      const updated = await tx
        .update(agents)
        .set(agentUpdates)
        .where(sql`lower(${agents.address}) = ${address}`)
        .returning({ address: agents.address });

      if (updated.length === 0) {
        await tx
          .insert(agents)
          .values({
            address,
            completedTasks: earnings.awardCount,
            ratedTasks: 0,
            skills: tags,
            totalEarnings: earnings.amount.toString(),
            totalStars: 0,
          })
          .onConflictDoUpdate({
            target: agents.address,
            set: agentUpdates,
          });
      }
    }
  });
}

import { and, eq, sql } from 'drizzle-orm';
import type { db } from '../db/client';
import { taskAwards } from '../db/schema';

type Database = Pick<typeof db, 'transaction'>;

type SettlementRating = {
  rating: number;
  taskId: string;
  workerAddress: string;
};

/**
 * Project an on-chain TaskRated event into every award for its recipient.
 */
export async function projectSettlementRating(
  database: Database,
  rating: SettlementRating
): Promise<void> {
  await database.transaction(async (tx) => {
    await tx
      .update(taskAwards)
      .set({ rating: rating.rating })
      .where(
        and(
          eq(taskAwards.taskId, rating.taskId),
          sql`lower(${taskAwards.workerAddress}) = lower(${rating.workerAddress})`
        )
      );
  });
}

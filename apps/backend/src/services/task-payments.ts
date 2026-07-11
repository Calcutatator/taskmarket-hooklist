import { eq } from 'drizzle-orm';
import { STANDARD_X402_ACTION_AMOUNT } from '../config/payments';
import type { db } from '../db/client';
import { tasks } from '../db/schema';

type Database = typeof db;

export function computeUpdatePaymentAmount(
  currentReward: string | null,
  requestedReward: string | undefined
): string {
  if (currentReward === null || requestedReward === undefined) {
    return STANDARD_X402_ACTION_AMOUNT;
  }

  const increase = BigInt(requestedReward) - BigInt(currentReward);
  return (BigInt(STANDARD_X402_ACTION_AMOUNT) + (increase > 0n ? increase : 0n)).toString();
}

export async function getUpdatePaymentAmount(
  database: Database,
  taskId: string,
  requestedReward: string | undefined
): Promise<string> {
  if (requestedReward === undefined) return STANDARD_X402_ACTION_AMOUNT;

  const rows = await database
    .select({ reward: tasks.reward })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);

  return computeUpdatePaymentAmount(rows[0]?.reward ?? null, requestedReward);
}

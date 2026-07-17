import type { db } from '../db/client';
import { requesterReputationEvents } from '../db/schema';

type Database = Pick<typeof db, 'insert'>;

export type RequesterReputationProjection = {
  eventType: string;
  requester: string;
  reward: string;
  selfAward: boolean;
  submissionCount: number;
  taskId: string;
  uniqueWorkers: number;
};

/** Persist one task-scoped reputation projection safely across event retries. */
export async function recordRequesterReputationEvent(
  database: Database,
  projection: RequesterReputationProjection
): Promise<void> {
  await database
    .insert(requesterReputationEvents)
    .values(projection)
    .onConflictDoNothing({ target: requesterReputationEvents.taskId });
}

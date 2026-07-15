import { eq } from 'drizzle-orm';

import type { db as DbType } from '../db/client';
import { taskDrops, taskDropTaskReservations } from '../db/schema';

type Db = typeof DbType;

export const TASK_DROP_RESERVATION_STALE_AFTER_MS = 30 * 60 * 1000;

export class TaskDropReservationError extends Error {
  constructor(
    message: string,
    readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'CONFLICT',
    readonly status: 403 | 404 | 409
  ) {
    super(message);
    this.name = 'TaskDropReservationError';
  }
}

export async function reserveTaskDropForCreation(input: {
  db: Db;
  payer: string;
  reservationId: string;
  taskDropId: string;
}): Promise<void> {
  const normalizedPayer = input.payer.toLowerCase();

  await input.db.transaction(async (tx) => {
    const rows = await tx
      .select({
        announcedAt: taskDrops.announcedAt,
        id: taskDrops.id,
        ownerAddress: taskDrops.ownerAddress,
      })
      .from(taskDrops)
      .where(eq(taskDrops.id, input.taskDropId))
      .limit(1)
      .for('update');
    const drop = rows[0];

    if (!drop) {
      throw new TaskDropReservationError('Task drop not found', 'NOT_FOUND', 404);
    }
    if (drop.ownerAddress.toLowerCase() !== normalizedPayer) {
      throw new TaskDropReservationError('Task drop is not owned by payer', 'FORBIDDEN', 403);
    }
    if (drop.announcedAt) {
      throw new TaskDropReservationError(
        'Official task drop has already been announced',
        'CONFLICT',
        409
      );
    }

    await tx.insert(taskDropTaskReservations).values({
      reservationId: input.reservationId,
      taskDropId: drop.id,
    });
  });
}

export async function releaseTaskDropReservation(input: {
  db: Db;
  reservationId: string;
}): Promise<void> {
  await input.db
    .delete(taskDropTaskReservations)
    .where(eq(taskDropTaskReservations.reservationId, input.reservationId));
}

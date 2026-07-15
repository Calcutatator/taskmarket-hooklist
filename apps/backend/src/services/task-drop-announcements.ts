import { randomUUID } from 'crypto';
import { and, eq, inArray, isNull, lt, lte, not, or, sql } from 'drizzle-orm';

import type { db as DbType } from '../db/client';
import {
  taskDropAnnouncementDeliveries,
  taskDrops,
  taskDropSubscriptions,
  taskDropTaskReservations,
  tasks,
} from '../db/schema';
import { sendOfficialTaskDropAnnouncement } from './task-drops-email';
import { TASK_DROP_RESERVATION_STALE_AFTER_MS } from './task-drop-reservations';

type Db = typeof DbType;

export type OfficialTaskDropAnnouncementResult = {
  announcedAt: Date;
  alreadyAnnounced: boolean;
  failed: number;
  pending: number;
  sent: number;
  total: number;
};

export async function announceOfficialTaskDrop(input: {
  db: Db;
  taskDropId: string;
}): Promise<OfficialTaskDropAnnouncementResult> {
  const { db, taskDropId } = input;

  const freeze = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ announcedAt: taskDrops.announcedAt, id: taskDrops.id })
      .from(taskDrops)
      .where(eq(taskDrops.id, taskDropId))
      .limit(1)
      .for('update');
    const drop = rows[0];
    if (!drop) throw new Error('Task drop not found during announcement');

    await tx
      .delete(taskDropTaskReservations)
      .where(
        and(
          eq(taskDropTaskReservations.taskDropId, taskDropId),
          lt(
            taskDropTaskReservations.createdAt,
            new Date(Date.now() - TASK_DROP_RESERVATION_STALE_AFTER_MS)
          )
        )
      );

    if (drop.announcedAt) {
      return { alreadyAnnounced: true, announcedAt: drop.announcedAt };
    }

    const reservations = await tx
      .select({ reservationId: taskDropTaskReservations.reservationId })
      .from(taskDropTaskReservations)
      .where(eq(taskDropTaskReservations.taskDropId, taskDropId))
      .limit(1);
    if (reservations[0]) throw new Error('Task drop has task creation in progress');

    const announcedAt = new Date();

    const updated = await tx
      .update(taskDrops)
      .set({ announcedAt })
      .where(and(eq(taskDrops.id, taskDropId), isNull(taskDrops.announcedAt)))
      .returning({ announcedAt: taskDrops.announcedAt });
    if (!updated[0]?.announcedAt) throw new Error('Task drop announcement could not be frozen');

    const subscriptions = await tx
      .select({ consentedAt: taskDropSubscriptions.consentedAt, id: taskDropSubscriptions.id })
      .from(taskDropSubscriptions)
      .where(
        and(
          eq(taskDropSubscriptions.scope, 'official'),
          eq(taskDropSubscriptions.status, 'active'),
          lte(taskDropSubscriptions.consentedAt, updated[0].announcedAt)
        )
      );
    const eligibleSubscriptions = subscriptions.filter(
      (subscription) => subscription.consentedAt <= updated[0]!.announcedAt!
    );

    if (eligibleSubscriptions.length > 0) {
      await tx
        .insert(taskDropAnnouncementDeliveries)
        .values(
          eligibleSubscriptions.map((subscription) => ({
            id: randomUUID(),
            status: 'pending',
            subscriptionConsentedAt: subscription.consentedAt,
            subscriptionId: subscription.id,
            taskDropId,
          }))
        )
        .onConflictDoNothing();
    }

    return { alreadyAnnounced: false, announcedAt: updated[0].announcedAt };
  });
  const { alreadyAnnounced, announcedAt } = freeze;

  const [dropRows, taskRows, deliveryRows] = await Promise.all([
    db.select().from(taskDrops).where(eq(taskDrops.id, taskDropId)).limit(1),
    db
      .select({ description: tasks.description, mode: tasks.mode, reward: tasks.reward })
      .from(tasks)
      .where(eq(tasks.taskDropId, taskDropId)),
    db
      .select({
        attempts: taskDropAnnouncementDeliveries.attempts,
        email: taskDropSubscriptions.email,
        id: taskDropAnnouncementDeliveries.id,
        processingAt: taskDropAnnouncementDeliveries.processingAt,
        scope: taskDropSubscriptions.scope,
        status: taskDropAnnouncementDeliveries.status,
        subscriptionConsentedAt: taskDropAnnouncementDeliveries.subscriptionConsentedAt,
        subscriptionCurrentConsentedAt: taskDropSubscriptions.consentedAt,
        subscriptionId: taskDropSubscriptions.id,
        subscriptionStatus: taskDropSubscriptions.status,
        subscriptionTaskDropId: taskDropSubscriptions.taskDropId,
      })
      .from(taskDropAnnouncementDeliveries)
      .innerJoin(
        taskDropSubscriptions,
        eq(taskDropSubscriptions.id, taskDropAnnouncementDeliveries.subscriptionId)
      )
      .where(eq(taskDropAnnouncementDeliveries.taskDropId, taskDropId)),
  ]);
  const drop = dropRows[0];
  if (!drop) throw new Error('Task drop disappeared during announcement');

  const staleProcessingCutoff = new Date(Date.now() - 15 * 60 * 1000);
  for (const delivery of deliveryRows) {
    const retryable = ['pending', 'failed'].includes(delivery.status);
    const staleProcessing =
      delivery.status === 'processing' &&
      delivery.processingAt !== null &&
      delivery.processingAt < staleProcessingCutoff;
    if (!retryable && !staleProcessing) continue;

    const claimableStatus = or(
      inArray(taskDropAnnouncementDeliveries.status, ['pending', 'failed']),
      and(
        eq(taskDropAnnouncementDeliveries.status, 'processing'),
        lt(taskDropAnnouncementDeliveries.processingAt, staleProcessingCutoff)
      )
    );
    const hasActiveConsent = sql`EXISTS (
      SELECT 1
      FROM ${taskDropSubscriptions}
      WHERE ${taskDropSubscriptions.id} = ${taskDropAnnouncementDeliveries.subscriptionId}
        AND ${taskDropSubscriptions.scope} = 'official'
        AND ${taskDropSubscriptions.status} = 'active'
        AND ${taskDropSubscriptions.consentedAt} = ${taskDropAnnouncementDeliveries.subscriptionConsentedAt}
    )`;

    const claimed = await db
      .update(taskDropAnnouncementDeliveries)
      .set({ processingAt: new Date(), status: 'processing', updatedAt: new Date() })
      .where(
        and(eq(taskDropAnnouncementDeliveries.id, delivery.id), claimableStatus, hasActiveConsent)
      )
      .returning({ id: taskDropAnnouncementDeliveries.id });
    if (!claimed[0]) {
      const skipped = await db
        .update(taskDropAnnouncementDeliveries)
        .set({ processingAt: null, status: 'skipped', updatedAt: new Date() })
        .where(
          and(
            eq(taskDropAnnouncementDeliveries.id, delivery.id),
            claimableStatus,
            not(hasActiveConsent)
          )
        )
        .returning({ id: taskDropAnnouncementDeliveries.id });
      if (skipped[0]) delivery.status = 'skipped';
      continue;
    }
    delivery.status = 'processing';

    if (
      delivery.subscriptionStatus !== 'active' ||
      delivery.scope !== 'official' ||
      delivery.subscriptionCurrentConsentedAt.getTime() !==
        delivery.subscriptionConsentedAt.getTime()
    ) {
      await db
        .update(taskDropAnnouncementDeliveries)
        .set({ processingAt: null, status: 'skipped', updatedAt: new Date() })
        .where(eq(taskDropAnnouncementDeliveries.id, delivery.id));
      delivery.status = 'skipped';
      continue;
    }

    try {
      await sendOfficialTaskDropAnnouncement({
        announcedAt,
        db,
        drop,
        subscription: {
          email: delivery.email,
          id: delivery.subscriptionId,
          scope: 'official',
          status: 'active',
          taskDropId: delivery.subscriptionTaskDropId,
        },
        tasks: taskRows,
      });
      await db
        .update(taskDropAnnouncementDeliveries)
        .set({
          attempts: delivery.attempts + 1,
          lastError: null,
          processingAt: null,
          sentAt: new Date(),
          status: 'sent',
          updatedAt: new Date(),
        })
        .where(eq(taskDropAnnouncementDeliveries.id, delivery.id));
      delivery.status = 'sent';
    } catch (error) {
      await db
        .update(taskDropAnnouncementDeliveries)
        .set({
          attempts: delivery.attempts + 1,
          lastError: error instanceof Error ? error.message : String(error),
          processingAt: null,
          status: 'failed',
          updatedAt: new Date(),
        })
        .where(eq(taskDropAnnouncementDeliveries.id, delivery.id));
      delivery.status = 'failed';
    }
  }

  return {
    announcedAt,
    alreadyAnnounced,
    failed: deliveryRows.filter((delivery) => delivery.status === 'failed').length,
    pending: deliveryRows.filter((delivery) => ['pending', 'processing'].includes(delivery.status))
      .length,
    sent: deliveryRows.filter((delivery) => delivery.status === 'sent').length,
    total: deliveryRows.length,
  };
}

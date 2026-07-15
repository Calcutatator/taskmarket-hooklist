import { createHmac, timingSafeEqual } from 'crypto';
import { and, eq } from 'drizzle-orm';

import { taskDrops, taskDropSubscriptions, tasks } from '../db/schema';
import {
  renderTaskmarketEmail,
  OfficialTaskDropAnnouncementEmail,
  OfficialTaskDropsWelcomeEmail,
  TaskDropNewTaskEmail,
  TaskDropsWelcomeEmail,
} from '../emails/task-drops';
import { getServerConfig } from '../config/env';
import { formatRewardUsdc, truncateText } from '../lib/email-format';
import { logger } from '../lib/logger';
import { sendEmail, type EmailTag } from './mailer';
import type { db as DbType } from '../db/client';

type Db = typeof DbType;

type TaskDropSubscription = Pick<
  typeof taskDropSubscriptions.$inferSelect,
  'email' | 'id' | 'scope' | 'status' | 'taskDropId'
>;

type OfficialAnnouncementTask = Pick<typeof tasks.$inferSelect, 'description' | 'mode' | 'reward'>;

export interface NotifyTaskDropSubscribersInput {
  db: Db;
  taskDropId: string;
  taskId: string;
  description: string;
  reward: string;
  mode: string;
  tags?: string[] | null;
}

export interface TaskDropEmailResult {
  failed: number;
  sent: number;
  total: number;
}

const CHUNK_SIZE = 50;
const SNIPPET_MAX = 280;

export function createTaskDropsUnsubscribeToken(subscription: TaskDropSubscription): string {
  const config = getServerConfig();
  return createHmac('sha256', config.PLATFORM_MASTER_KEY)
    .update(`${subscription.id}:${subscription.email}`)
    .digest('hex');
}

export function verifyTaskDropsUnsubscribeToken(
  subscription: TaskDropSubscription,
  token: string
): boolean {
  const expected = createTaskDropsUnsubscribeToken(subscription);
  const expectedBuffer = Buffer.from(expected, 'hex');
  const tokenBuffer = Buffer.from(token, 'hex');
  return (
    expectedBuffer.length === tokenBuffer.length && timingSafeEqual(expectedBuffer, tokenBuffer)
  );
}

export function buildTaskDropsUnsubscribeUrl(subscription: TaskDropSubscription): string {
  const config = getServerConfig();
  const url = new URL('/task-drops/unsubscribe', config.BACKEND_URL);
  url.searchParams.set('id', subscription.id);
  url.searchParams.set('token', createTaskDropsUnsubscribeToken(subscription));
  return url.toString();
}

function buildTaskUrl(taskId: string): string {
  const config = getServerConfig();
  return new URL(`/dashboard/tasks/${taskId}`, config.WEB_APP_URL).toString();
}

function buildDropUrl(taskDropId: string): string {
  const config = getServerConfig();
  return new URL(`/drops/${taskDropId}`, config.WEB_APP_URL).toString();
}

function buildDashboardUrl(): string {
  const config = getServerConfig();
  return new URL('/dashboard', config.WEB_APP_URL).toString();
}

function buildTaskDropsUrl(): string {
  const config = getServerConfig();
  return new URL('/taskdrop', config.WEB_APP_URL).toString();
}

function fromAddress(): string {
  const config = getServerConfig();
  return `noreply@${config.EMAIL_DOMAIN}`;
}

const taskDropsTags: EmailTag[] = [{ name: 'source', value: 'task_drops' }];

export async function sendTaskDropsWelcome(input: {
  db: Db;
  subscription: TaskDropSubscription;
  taskDropId: string;
}): Promise<void> {
  const { db, subscription, taskDropId } = input;
  if (subscription.status !== 'active') {
    return;
  }

  const dropRows = await db.select().from(taskDrops).where(eq(taskDrops.id, taskDropId)).limit(1);
  const drop = dropRows[0];

  if (!drop) {
    return;
  }

  const { bodyHtml, bodyText } = await renderTaskmarketEmail(
    TaskDropsWelcomeEmail({
      dashboardUrl: buildDashboardUrl(),
      dropName: drop.name,
      dropUrl: buildDropUrl(taskDropId),
      unsubscribeUrl: buildTaskDropsUnsubscribeUrl(subscription),
    })
  );

  await sendEmail({
    bodyHtml,
    bodyText,
    db,
    from: fromAddress(),
    idempotencyKey: `task-drops-welcome-${taskDropId}-${subscription.id}`,
    subject: `You are following ${drop.name}`,
    tags: [...taskDropsTags, { name: 'type', value: 'welcome' }],
    to: subscription.email,
  });
}

export async function sendOfficialTaskDropsWelcome(input: {
  consentAt: Date;
  db: Db;
  subscription: TaskDropSubscription;
}): Promise<void> {
  const { consentAt, db, subscription } = input;
  if (subscription.status !== 'active' || subscription.scope !== 'official') return;

  const { bodyHtml, bodyText } = await renderTaskmarketEmail(
    OfficialTaskDropsWelcomeEmail({
      taskDropsUrl: buildTaskDropsUrl(),
      unsubscribeUrl: buildTaskDropsUnsubscribeUrl(subscription),
    })
  );

  await sendEmail({
    bodyHtml,
    bodyText,
    db,
    from: fromAddress(),
    idempotencyKey: `official-task-drops-welcome-${subscription.id}-${consentAt.getTime()}`,
    subject: 'You are subscribed to official Task Drops',
    tags: [...taskDropsTags, { name: 'type', value: 'official_welcome' }],
    to: subscription.email,
  });
}

export async function sendOfficialTaskDropAnnouncement(input: {
  announcedAt: Date;
  db: Db;
  drop: typeof taskDrops.$inferSelect;
  subscription: TaskDropSubscription;
  tasks: OfficialAnnouncementTask[];
}): Promise<void> {
  const { announcedAt, db, drop, subscription, tasks: announcementTasks } = input;
  if (subscription.status !== 'active' || subscription.scope !== 'official') return;

  const { bodyHtml, bodyText } = await renderTaskmarketEmail(
    OfficialTaskDropAnnouncementEmail({
      announcedAt: announcedAt.toISOString(),
      description: drop.description,
      dropName: drop.name,
      dropUrl: buildDropUrl(drop.id),
      tasks: announcementTasks.map((task) => ({
        description: truncateText(task.description, SNIPPET_MAX),
        mode: task.mode,
        rewardLabel: formatRewardUsdc(task.reward.toString()),
      })),
      unsubscribeUrl: buildTaskDropsUnsubscribeUrl(subscription),
    })
  );

  await sendEmail({
    bodyHtml,
    bodyText,
    db,
    from: fromAddress(),
    idempotencyKey: `official-task-drop-announcement-${drop.id}-${subscription.id}`,
    subject: `${drop.name} is live on Taskmarket`,
    tags: [...taskDropsTags, { name: 'type', value: 'official_announcement' }],
    to: subscription.email,
  });
}

export async function notifyTaskDropSubscribers(
  input: NotifyTaskDropSubscribersInput
): Promise<TaskDropEmailResult> {
  const { db, taskDropId, taskId, description, mode, reward, tags } = input;
  const dropRows = await db.select().from(taskDrops).where(eq(taskDrops.id, taskDropId)).limit(1);
  const drop = dropRows[0];

  if (!drop) {
    return { failed: 0, sent: 0, total: 0 };
  }

  const subscriptions = await db
    .select()
    .from(taskDropSubscriptions)
    .where(
      and(
        eq(taskDropSubscriptions.taskDropId, taskDropId),
        eq(taskDropSubscriptions.scope, 'drop'),
        eq(taskDropSubscriptions.status, 'active')
      )
    );

  if (subscriptions.length === 0) {
    return { failed: 0, sent: 0, total: 0 };
  }

  const snippet = truncateText(description, SNIPPET_MAX);
  const rewardLabel = formatRewardUsdc(reward);
  const normalizedTags = tags ?? [];
  const subject = `${drop.name}: ${truncateText(description, 80)}`;

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < subscriptions.length; i += CHUNK_SIZE) {
    const chunk = subscriptions.slice(i, i + CHUNK_SIZE);
    const results = await Promise.allSettled(
      chunk.map(async (subscription) => {
        const { bodyHtml, bodyText } = await renderTaskmarketEmail(
          TaskDropNewTaskEmail({
            description: snippet,
            dropName: drop.name,
            mode,
            rewardLabel,
            tags: normalizedTags,
            taskId,
            taskUrl: buildTaskUrl(taskId),
            unsubscribeUrl: buildTaskDropsUnsubscribeUrl(subscription),
          })
        );

        await sendEmail({
          bodyHtml,
          bodyText,
          db,
          from: fromAddress(),
          idempotencyKey: `task-drop-${taskDropId}-${taskId}-${subscription.id}`,
          subject,
          tags: [...taskDropsTags, { name: 'type', value: 'new_task' }],
          to: subscription.email,
        });
      })
    );
    sent += results.filter((result) => result.status === 'fulfilled').length;
    failed += results.filter((result) => result.status === 'rejected').length;
  }

  if (failed > 0) {
    logger.warn(`notifyTaskDropSubscribers: ${failed}/${subscriptions.length} sends failed`);
  }

  return { failed, sent, total: subscriptions.length };
}

export async function unsubscribeTaskDropsSubscription(input: {
  db: Db;
  id: string;
  token: string;
}): Promise<{ email: string; scope: 'drop' | 'official' | null; unsubscribed: boolean }> {
  const rows = await input.db
    .select()
    .from(taskDropSubscriptions)
    .where(and(eq(taskDropSubscriptions.id, input.id), eq(taskDropSubscriptions.status, 'active')))
    .limit(1);
  const subscription = rows[0];

  if (!subscription || !verifyTaskDropsUnsubscribeToken(subscription, input.token)) {
    return { email: '', scope: null, unsubscribed: false };
  }

  await input.db
    .update(taskDropSubscriptions)
    .set({
      status: 'unsubscribed',
      unsubscribedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(taskDropSubscriptions.id, subscription.id));

  return {
    email: subscription.email,
    scope: subscription.scope === 'official' ? 'official' : 'drop',
    unsubscribed: true,
  };
}

export async function getTaskDropsUnsubscribeDetails(input: {
  db: Db;
  id: string;
  token: string;
}): Promise<{ email: string; scope: 'drop' | 'official' } | null> {
  const rows = await input.db
    .select()
    .from(taskDropSubscriptions)
    .where(and(eq(taskDropSubscriptions.id, input.id), eq(taskDropSubscriptions.status, 'active')))
    .limit(1);
  const subscription = rows[0];

  if (!subscription || !verifyTaskDropsUnsubscribeToken(subscription, input.token)) return null;

  return {
    email: subscription.email,
    scope: subscription.scope === 'official' ? 'official' : 'drop',
  };
}

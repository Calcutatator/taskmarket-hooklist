import { sendEmail } from './mailer';
import { selectTargetAgents } from './agent-targeting';
import { getServerConfig } from '../config/env';
import { formatRewardUsdc, truncateText } from '../lib/email-format';
import { logger } from '../lib/logger';
import type { db as DbType } from '../db/client';

type Db = typeof DbType;

export interface NotifyNewTaskInput {
  db: Db;
  taskId: string;
  description: string;
  reward: string;
  mode: string;
  tags?: string[] | null;
}

export interface NotifyNewTaskResult {
  sent: number;
  failed: number;
  total: number;
}

const CHUNK_SIZE = 50;
const SNIPPET_MAX = 280;

// Build the concise plain-text body the daemon's emailPollLoop relays verbatim.
// Idempotent by taskId: the taskId is embedded so a worker (or the daemon) can
// dedupe even if the same task is referenced more than once.
export function buildNewTaskEmail(input: {
  taskId: string;
  description: string;
  reward: string;
  mode: string;
  tags?: string[] | null;
}): { subject: string; bodyText: string } {
  const snippet = truncateText(input.description, SNIPPET_MAX);
  const rewardLabel = formatRewardUsdc(input.reward);
  const tags = input.tags ?? [];
  const subject = `New task: ${truncateText(input.description, 80)}`;

  const lines = [
    'A new task matching your skills was just posted.',
    '',
    `Task: ${input.taskId}`,
    `Reward: ${rewardLabel}`,
    `Mode: ${input.mode}`,
  ];
  if (tags.length > 0) {
    lines.push(`Tags: ${tags.join(', ')}`);
  }
  lines.push('', snippet, '', `View: /dashboard/tasks/${input.taskId}`);

  return { subject, bodyText: lines.join('\n') };
}

/**
 * Fire a targeted "new task" notification to eligible worker agents via the email
 * broadcast fan-out. When the task has tags, target agents whose skills match
 * those tags; otherwise fall back to all eligible (email-registered) agents, the
 * same default the broadcast uses.
 *
 * This must NEVER throw in a way that affects task creation: callers invoke it
 * fire-and-forget (`void notifyNewTask(...).catch(...)`). Individual send failures
 * are isolated via Promise.allSettled and counted, never rethrown.
 */
export async function notifyNewTask(input: NotifyNewTaskInput): Promise<NotifyNewTaskResult> {
  const { db, taskId, description, reward, mode, tags } = input;
  const config = getServerConfig();

  const hasTags = Array.isArray(tags) && tags.length > 0;
  const recipients = await selectTargetAgents(db, hasTags ? { skills: tags } : {});

  if (recipients.length === 0) {
    return { sent: 0, failed: 0, total: 0 };
  }

  const { subject, bodyText } = buildNewTaskEmail({ taskId, description, reward, mode, tags });
  const fromAddress = `noreply@${config.EMAIL_DOMAIN}`;

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < recipients.length; i += CHUNK_SIZE) {
    const chunk = recipients.slice(i, i + CHUNK_SIZE);
    const results = await Promise.allSettled(
      chunk.map(async (recipient) => {
        await sendEmail({
          db,
          from: fromAddress,
          to: recipient.emailAddress,
          subject,
          bodyText,
        });
      })
    );
    sent += results.filter((r) => r.status === 'fulfilled').length;
    failed += results.filter((r) => r.status === 'rejected').length;
  }

  if (failed > 0) {
    logger.warn(`notifyNewTask: ${failed}/${recipients.length} sends failed for task ${taskId}`);
  }

  return { sent, failed, total: recipients.length };
}

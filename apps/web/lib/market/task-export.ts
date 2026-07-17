import type { TaskDetailResponse, TaskResponse } from '@taskmarket/shared';

import { formatUsdcUnits } from '@/lib/format';

// Pure, framework-free serializers for the "copy for your agent" affordance. They take
// the same task + modeData shapes the detail panel renders and produce a clean JSON
// string or a readable markdown string an operator can paste straight into an LLM.
// No React, no DOM - kept here so they are trivially unit-testable.

// Structural subset of components/market/tasks.tsx TaskModeData. Declared locally to
// avoid importing a React module into this framework-free helper; only the lengths are
// read, so a minimal shape keeps the dependency surface flat.
export type TaskExportModeData = {
  bids?: unknown[];
  pitches?: unknown[];
  proofs?: unknown[];
  submissions?: unknown[];
};

function taskTitle(task: Pick<TaskResponse, 'description' | 'id'>): string {
  return task.description.split('\n')[0]?.slice(0, 80).trim() || `Task ${task.id}`;
}

// Body is everything after the first line; fall back to the full description when the
// brief is a single line. Mirrors taskBody() in tasks.tsx.
function taskBody(task: Pick<TaskResponse, 'description'>): string {
  const description = task.description.trim();
  const body = description.split('\n').slice(1).join('\n').trim();
  return body || description;
}

// Count of in-flight activity for the task's mode, read from modeData when present and
// otherwise from the denormalised counters on the task. Mirrors activityCount() in tasks.tsx.
function activityCount(task: TaskResponse, modeData?: TaskExportModeData): number {
  switch (task.mode) {
    case 'auction':
      return task.auctionBidCount ?? modeData?.bids?.length ?? 0;
    case 'benchmark':
      return modeData?.proofs?.length ?? 0;
    case 'pitch':
      return task.pitchCount ?? modeData?.pitches?.length ?? 0;
    default:
      return task.submissionCount ?? modeData?.submissions?.length ?? 0;
  }
}

function activityKey(mode: TaskResponse['mode']): 'bids' | 'proofs' | 'pitches' | 'submissions' {
  switch (mode) {
    case 'auction':
      return 'bids';
    case 'benchmark':
      return 'proofs';
    case 'pitch':
      return 'pitches';
    default:
      return 'submissions';
  }
}

// Serialize a task into a clean, stable-key-ordered JSON string (2-space indent) suitable
// for handing to an agent. reward is a base-unit string from the API - it is passed
// through verbatim alongside a human-readable rewardFormatted, never coerced with Number().
export function taskToAgentJson(
  task: TaskDetailResponse | TaskResponse,
  modeData?: TaskExportModeData
): string {
  // Build object with a deliberate, stable key order. Mode-specific fields are appended
  // only when relevant so the payload stays compact and meaningful.
  const payload: Record<string, unknown> = {
    id: task.id,
    description: task.description,
    mode: task.mode,
    status: task.status,
    reward: task.reward,
    rewardFormatted: formatUsdcUnits(task.reward),
    tags: task.tags,
    expiryTime: task.expiryTime,
    requester: task.requester,
  };

  if (task.awardCount) {
    payload.awardCount = task.awardCount;
    if ('awards' in task) {
      payload.awards = task.awards ?? [];
    }
  }

  if (task.stakeRequired) {
    payload.stakeRequired = task.stakeRequired;
    payload.stakeBps = task.stakeBps;
  }

  if (task.mode === 'auction' && task.maxPrice) {
    payload.maxPrice = task.maxPrice;
  }

  if (task.mode === 'benchmark') {
    if (task.metricDescription) {
      payload.metricDescription = task.metricDescription;
    }
    if (task.metricTarget) {
      payload.metricTarget = task.metricTarget;
    }
  }

  payload.activity = {
    [activityKey(task.mode)]: activityCount(task, modeData),
  };

  return JSON.stringify(payload, null, 2);
}

// Serialize a task into readable markdown - a title line followed by labelled bullet
// fields and the full brief. Suitable to paste into an LLM as context.
export function taskToMarkdown(task: TaskDetailResponse | TaskResponse): string {
  const lines: string[] = [];

  lines.push(`# ${taskTitle(task)}`);
  lines.push('');
  lines.push(`- Mode: ${task.mode}`);
  lines.push(`- Status: ${task.status}`);
  lines.push(`- Reward: ${formatUsdcUnits(task.reward)}`);
  lines.push(`- Deadline: ${task.expiryTime}`);
  lines.push(`- Tags: ${task.tags.length ? task.tags.join(', ') : 'none'}`);
  if (task.awardCount) {
    lines.push(`- Award count: ${task.awardCount}`);
  }
  lines.push('');
  lines.push('## Brief');
  lines.push(taskBody(task));

  if ('awards' in task && task.awards && task.awards.length > 0) {
    lines.push('');
    lines.push('## Payouts');
    for (const award of task.awards) {
      lines.push(
        `- Rank ${award.rank}: ${award.workerAddress}${award.isPrimary ? ' (primary)' : ''}; gross ${formatUsdcUnits(award.grossAmount)}; net ${formatUsdcUnits(award.workerPayment)}; fee ${formatUsdcUnits(award.platformFee)}; rating ${award.rating ?? 'pending'}; tx ${award.settlementTxHash}`
      );
    }
  }

  return lines.join('\n');
}

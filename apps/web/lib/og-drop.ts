import type { TaskDropDirectoryItem, TaskDropPageData } from '@taskmarket/shared';

import { formatUsdcUnits } from '@/lib/format';

/**
 * Copy for the Task Drop link-preview card, shared by /drops/[dropId] and /live so a
 * drop looks identical however it was linked.
 *
 * The card image carries two things only, in this order:
 *   1. the call to action  ("Enter the latest Task Drop:")
 *   2. the drop's name     ("Insects x AI: what insect engineering teaches machines")
 *
 * `description` ("12 open tasks · 60 USDC in prizes") is NOT drawn on the image. It is the
 * page's og:description, which Discord and Slack render as text beside the card. Keeping it
 * off the image was a legibility call; the information still travels.
 *
 * Amounts: a drop's total prize fund is cleared for the card (secretive, 2026-07-25). It is
 * already public on the drop page and it is the number that makes the card worth clicking.
 * Fees, DREAMS and projections stay off every card.
 */
export type DropCardCopy = {
  badge: string;
  description: string;
  title: string;
};

// The eyebrow carries the call to action. Flat text, not a chip: the pink chip on these cards
// is the logo, and a second pink chip competed with it.
const CTA = 'Enter the latest Task Drop:';

const FALLBACK: DropCardCopy = {
  badge: CTA,
  description: 'One theme, funded tasks, and the whole market competing.',
  title: 'The latest Task Drop.',
};

function sumRewards(tasks: ReadonlyArray<{ reward: string }>) {
  let total = 0n;
  for (const task of tasks) {
    try {
      total += BigInt(task.reward);
    } catch {
      // A malformed reward should never cost us the whole card.
    }
  }

  return total.toString();
}

/**
 * Counts the tasks someone could actually still enter.
 *
 * Must match the backend's `availableTaskCount` (task-drops router): open AND not past
 * expiry. Nothing flips `status` when a task expires, so filtering on `status === 'open'`
 * alone would call a finished drop live — and then /drops/[dropId] would say "Enter" while
 * /live said "judging closed" for the same drop. The two must agree.
 *
 * This makes the copy time-dependent, which is fine: a card is scraped once and the drop it
 * describes has a fixed lifetime.
 */
function availableCount(tasks: ReadonlyArray<{ expiryTime: string; status: string }>, now: number) {
  return tasks.filter((task) => {
    if (task.status !== 'open') {
      return false;
    }

    const expiry = new Date(task.expiryTime).getTime();
    return Number.isNaN(expiry) ? true : expiry > now;
  }).length;
}

function plural(count: number, word: string) {
  return `${count} ${count === 1 ? word : `${word}s`}`;
}

// The card is scraped once and cached by the platform for a long time, so the subline
// carries facts about the drop rather than anything that reads as a live countdown.
function describe(openCount: number, taskCount: number, totalReward: string): string {
  // A zero total means the drop is unfunded or the figure is missing. Saying "0 USDC in
  // prizes" is worse than saying nothing about the money.
  const prize = totalReward === '0' ? null : `${formatUsdcUnits(totalReward)} in prizes`;

  const parts =
    openCount > 0
      ? [plural(openCount, 'open task'), prize]
      : [plural(taskCount, 'task'), prize, 'judging closed'];

  return parts.filter(Boolean).join(' · ');
}

// A finished drop must not shout "enter". It gets the plain label instead.
function badgeFor(openCount: number) {
  return { badge: openCount > 0 ? CTA : 'Task Drop' };
}

/** Card copy from a full drop page payload (`/drops/[dropId]`). */
export function dropCardCopy(
  data: TaskDropPageData | null | undefined,
  now: number = Date.now()
): DropCardCopy {
  if (!data) {
    return FALLBACK;
  }

  const openCount = availableCount(data.tasks, now);

  return {
    ...badgeFor(openCount),
    description: describe(openCount, data.tasks.length, sumRewards(data.tasks)),
    title: data.drop.name,
  };
}

/** Card copy from a directory row (`/live`), which already carries the totals. */
export function dropCardCopyFromDirectory(
  item: TaskDropDirectoryItem | null | undefined
): DropCardCopy {
  if (!item) {
    return FALLBACK;
  }

  return {
    ...badgeFor(item.availableTaskCount),
    description: describe(item.availableTaskCount, item.taskCount, item.totalReward),
    title: item.drop.name,
  };
}

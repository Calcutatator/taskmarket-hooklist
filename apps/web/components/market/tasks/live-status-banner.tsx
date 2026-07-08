'use client';

import type { TaskDetailResponse, TaskResponse } from '@taskmarket/shared';
import { useAccount } from 'wagmi';

import { AnimatedNumber } from '@/components/market/motion/animated-number';
import { CountdownTimer } from '@/components/market/motion/countdown-timer';
import { useMotionDisabled } from '@/components/market/motion/use-motion-disabled';
import {
  ACTIVE_THRESHOLD,
  activityNoun,
  isTerminalStatus,
  useTaskActivitySummary,
} from '@/components/market/live-activity';
import { type TaskModeData, taskDeadlineSource } from '@/components/market/tasks';
import type { MarketStats } from '@/lib/api/server';

// A slim, always-mounted status banner for the top of an open task. It answers
// "is anything happening?" honestly: with no activity it frames the wait around
// the live market (or a countdown), and once work lands it flips to a live count.
// It renders nothing outside the open-and-taking-work window, so it is safe to
// drop into the layout unconditionally.
export function LiveStatusBanner({
  marketStats,
  modeData,
  task,
}: {
  marketStats?: MarketStats | null;
  modeData?: TaskModeData;
  task: TaskDetailResponse | TaskResponse;
}) {
  const motionDisabled = useMotionDisabled();
  const { address } = useAccount();
  const isOwner = Boolean(address && address.toLowerCase() === task.requester.toLowerCase());

  // Only meaningful while the task is open and still taking work. A terminal task
  // or a closed submission window has no live story to tell. Gate the shared poll
  // on this so a hidden banner never enables a query the activity panel would not
  // (terminal tasks poll nowhere else) - keeps the banner a strict subset.
  const isOpenForWork =
    task.status === 'open' && task.submissionWindowOpen === true && !isTerminalStatus(task);
  const { count, hasActivity, latestActor } = useTaskActivitySummary(task, modeData, isOpenForWork);

  if (!isOpenForWork) {
    return null;
  }

  const activeWorkers = marketStats?.activeWorkers7d ?? null;
  const quietMarket = activeWorkers === null || activeWorkers < ACTIVE_THRESHOLD;
  const noun = activityNoun(task);

  const title = hasActivity ? 'Work is arriving' : 'Live and broadcasting to the network';

  let body: string;
  if (hasActivity) {
    const nounForm = count === 1 ? noun.singular : noun.plural;
    body = `${count} ${nounForm} so far - still open and taking more.`;
    if (latestActor) {
      body += ` Latest from ${latestActor}.`;
    }
  } else if (quietMarket) {
    body = isOwner
      ? `Live and broadcasting. It's quiet right now, so you may be first in line - grab a coffee, ${noun.plural} usually land soon.`
      : `A quiet market right now - you may be among the first tasks workers see. ${noun.plural} land here as they arrive.`;
  } else {
    body = isOwner
      ? `${activeWorkers} workers were active this week - work usually lands soon. Grab a coffee; ${noun.plural} will appear here.`
      : `${activeWorkers} workers were active this week. First ${noun.plural} usually arrive soon.`;
  }

  return (
    <div
      aria-label="Task status"
      aria-live="polite"
      className="flex flex-col gap-3 rounded-lg border border-border/58 bg-card/44 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      role="status"
      style={{ boxShadow: '0 0 0 1px color-mix(in oklab, var(--success) 22%, transparent)' }}
    >
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="relative inline-flex size-2.5">
          <span className="size-2.5 rounded-full bg-accent" />
          <span
            className={`absolute inset-0 rounded-full bg-accent/60 ${motionDisabled ? '' : 'animate-ping'}`}
          />
        </span>
        <div className="grid gap-0.5">
          <p className="font-display text-sm font-semibold tracking-tight text-foreground">
            {title}
          </p>
          <p className="text-sm text-muted-foreground">{body}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:justify-end">
        {hasActivity ? (
          <p className="text-sm text-foreground">
            <AnimatedNumber value={count} />{' '}
            <span className="text-muted-foreground">
              {count === 1 ? noun.singular : noun.plural}
            </span>
          </p>
        ) : (
          <p className="flex items-center gap-2">
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.08em] text-muted-foreground">
              Deadline
            </span>
            <CountdownTimer className="text-sm" source={taskDeadlineSource(task)} />
          </p>
        )}
      </div>
    </div>
  );
}

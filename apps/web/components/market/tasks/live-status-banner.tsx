'use client';

import type { TaskDetailResponse, TaskResponse } from '@taskmarket/shared';
import type { Route } from 'next';
import Link from 'next/link';
import { useAccount } from 'wagmi';

import { AnimatedNumber } from '@/components/market/motion/animated-number';
import { CountdownTimer } from '@/components/market/motion/countdown-timer';
import { useMotionDisabled } from '@/components/market/motion/use-motion-disabled';
import {
  ACTIVE_THRESHOLD,
  activityNoun,
  isOpenForWork,
  useTaskActivitySummary,
} from '@/components/market/live-activity';
import { type TaskModeData, taskDeadlineSource } from '@/components/market/tasks';
import { Button } from '@/components/ui/button';
import type { MarketStats } from '@/lib/api/server';

import { requesterWaitingCopy } from './requester-task-guidance';

function reviewReadyTitle(count: number, noun: { plural: string; singular: string }) {
  return `${count} ${count === 1 ? noun.singular : noun.plural} ready to review`;
}

function requesterReadyCopy(task: TaskDetailResponse | TaskResponse) {
  switch (task.mode) {
    case 'benchmark':
      return 'Review the proofs, choose the eligible result or results, and complete the task here or from your Inbox.';
    case 'pitch':
      return 'Compare the pitches and select a worker here or from your Inbox. Delivery starts after your selection.';
    case 'auction':
      if (task.status === 'pending_approval') {
        return 'Bidding has closed and the selected worker has delivered. Review the submission and release payment when it meets the brief.';
      }
      return 'Bidding is still open. The lowest eligible bid can be finalized after the window closes; there is nothing to select yet.';
    case 'claim':
    case 'bounty':
    default:
      return 'Review the submitted work and release payment when it meets the brief. You can continue here or from your Inbox.';
  }
}

// A slim, always-mounted status banner for the top of an open task. It answers
// "is anything happening?" honestly: with no activity it frames the wait around
// the live market (or a countdown), and once work lands it flips to a live count.
// It renders nothing outside the open-and-taking-work window, so it is safe to
// drop into the layout unconditionally.
export function LiveStatusBanner({
  marketStats,
  modeData,
  task,
  viewerAddress,
}: {
  marketStats?: MarketStats | null;
  modeData?: TaskModeData;
  task: TaskDetailResponse | TaskResponse;
  viewerAddress?: string;
}) {
  const motionDisabled = useMotionDisabled();
  const { address } = useAccount();
  const activeAddress = viewerAddress ?? address;
  const isOwner = Boolean(
    activeAddress && activeAddress.toLowerCase() === task.requester.toLowerCase()
  );

  // Only meaningful while the task is open and still taking work (claims,
  // pitches, bids, or submissions by mode). A terminal task or a closed intake
  // window has no live story to tell. Gate the shared poll on this so a hidden
  // banner never enables a query the activity panel would not (terminal tasks
  // poll nowhere else) - keeps the banner a strict subset.
  const openForWork = isOpenForWork(task);
  const { count, hasActivity, latestActor } = useTaskActivitySummary(task, modeData, openForWork);

  const waitingForDelivery =
    isOwner && (task.status === 'claimed' || task.status === 'worker_selected');
  const deliveryReady = isOwner && task.status === 'pending_approval';

  if (!openForWork && !waitingForDelivery && !deliveryReady) {
    return null;
  }

  const activeWorkers = marketStats?.activeWorkers7d ?? null;
  const quietMarket = activeWorkers === null || activeWorkers < ACTIVE_THRESHOLD;
  const noun = activityNoun(task);

  const reviewCount = deliveryReady ? Math.max(task.submissionCount ?? 0, 1) : count;

  let title: string;
  if (waitingForDelivery) {
    title = 'No action needed - waiting for delivery';
  } else if (deliveryReady) {
    title = reviewReadyTitle(reviewCount, { plural: 'submissions', singular: 'submission' });
  } else if (isOwner && hasActivity) {
    title =
      task.mode === 'auction'
        ? `${count} ${count === 1 ? 'bid' : 'bids'} received`
        : reviewReadyTitle(count, noun);
  } else if (hasActivity) {
    title = 'Work is arriving';
  } else {
    title = isOwner ? 'No action needed yet' : 'Live and broadcasting to the network';
  }

  let body: string;
  if (waitingForDelivery) {
    body =
      'A worker is assigned and preparing the deliverable. Their submission will appear here and in your Inbox when it is ready to review.';
  } else if (deliveryReady) {
    body = requesterReadyCopy(task);
  } else if (isOwner && hasActivity) {
    body = requesterReadyCopy(task);
  } else if (hasActivity) {
    const nounForm = count === 1 ? noun.singular : noun.plural;
    body = `${count} ${nounForm} so far - still open and taking more.`;
    if (latestActor) {
      body += ` Latest from ${latestActor}.`;
    }
  } else if (isOwner) {
    body = requesterWaitingCopy(task);
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
        {isOwner ? (
          <Button asChild size="sm" variant="outline">
            <Link href={'/dashboard/inbox' as Route}>Open Inbox</Link>
          </Button>
        ) : null}
        {hasActivity || deliveryReady ? (
          <p className="text-sm text-foreground">
            <AnimatedNumber value={reviewCount} />{' '}
            <span className="text-muted-foreground">
              {deliveryReady
                ? reviewCount === 1
                  ? 'submission'
                  : 'submissions'
                : count === 1
                  ? noun.singular
                  : noun.plural}
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

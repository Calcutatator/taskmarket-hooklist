'use client';

import type { ActivityFeedResponse, ActivityType } from '@taskmarket/shared';
import Link from 'next/link';

import { RelativeTime } from '@/components/market/motion/relative-time';
import { trpc } from '@/lib/api/client';
import { compactAddress, formatUsdcUnits } from '@/lib/format';

// Short verb labels keep each row scannable; the type carries the colour-free
// signal and the title carries the detail. Mirrors the badge label phrasing on
// the task pages so the feed reads as the same vocabulary.
const ACTIVITY_VERB: Record<ActivityType, string> = {
  task_created: 'Task posted',
  task_submitted: 'Submission',
  task_claimed: 'Claimed',
  task_pitched: 'Pitch',
  bid_placed: 'Bid',
  task_rated: 'Rated',
};

function activityVerb(type: ActivityType): string {
  return ACTIVITY_VERB[type] ?? 'Activity';
}

type ActivityItem = ActivityFeedResponse['items'][number];

function ActivityRow({ item }: { item: ActivityItem }) {
  const title = item.taskTitle?.trim() || 'Untitled task';
  const amount = item.amount ? formatUsdcUnits(item.amount) : null;

  return (
    <li className="border-b border-border/58 last:border-b-0">
      <Link
        className="grid gap-1 px-4 py-3 transition-colors hover:bg-surface/44"
        href={`/dashboard/tasks/${item.taskId}`}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[0.65rem] uppercase tracking-wide text-primary">
            {activityVerb(item.type)}
          </span>
          <RelativeTime
            className="font-mono text-[0.65rem] text-muted-foreground"
            value={item.timestamp}
          />
        </div>
        <p className="truncate text-sm font-medium text-foreground" title={title}>
          {title}
        </p>
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[0.65rem] uppercase text-muted-foreground">
            {compactAddress(item.actor)}
          </span>
          {amount ? (
            <span className="font-mono text-xs font-semibold text-primary">{amount}</span>
          ) : null}
        </div>
      </Link>
    </li>
  );
}

// A compact live activity rail. Seeds from the SSR snapshot and refetches every
// fifteen seconds; honest presence means rows only move when the feed actually
// changes. When the backend is unreachable at render time the page passes an
// empty initial feed and this degrades to the designed empty state below.
export function DashboardActivityFeed({ initialData }: { initialData: ActivityFeedResponse }) {
  const { data } = trpc.stats.activityFeed.useQuery(
    { limit: 12 },
    {
      initialData,
      refetchInterval: 15_000,
      refetchOnWindowFocus: true,
    }
  );

  const items = data?.items ?? [];

  return (
    <section
      aria-label="Recent activity"
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border/58 bg-card/44"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border/58 px-4 py-3">
        <h3 className="font-mono text-xs uppercase tracking-wide text-primary">Live activity</h3>
        <span className="font-mono text-[0.65rem] uppercase text-muted-foreground">
          updates 15s
        </span>
      </header>
      {items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 py-10 text-center">
          <p className="max-w-[24ch] font-mono text-xs uppercase text-muted-foreground">
            No activity yet. Posts, bids, and submissions land here as they happen.
          </p>
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto" data-testid="dashboard-activity-list">
          {items.map((item) => (
            <ActivityRow item={item} key={`${item.type}-${item.taskId}-${item.timestamp}`} />
          ))}
        </ul>
      )}
    </section>
  );
}

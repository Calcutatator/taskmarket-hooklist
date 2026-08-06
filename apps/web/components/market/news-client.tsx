'use client';

import type { ActivityFeedResponse, ActivityType } from '@taskmarket/shared';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { InboxClient } from '@/components/market/inbox-client';
import { RelativeTime } from '@/components/market/motion/relative-time';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { trpc } from '@/lib/api/client';
import { compactAddress, formatUsdcUnits } from '@/lib/format';

// Short verb labels keep each row scannable. Mirrors the phrasing in
// dashboard-activity-feed.tsx so the global feed reads as the same vocabulary
// across the dashboard and the News page.
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

// Segment filter chips map a UI label to the set of activity types passed to the
// backend `types` param. "All" sends no filter (undefined) so the server returns
// every type. Purely client-side - no backend change required.
const FEED_SEGMENTS: { label: string; types?: ActivityType[] }[] = [
  { label: 'All', types: undefined },
  { label: 'New tasks', types: ['task_created'] },
  { label: 'Submissions', types: ['task_submitted', 'task_pitched', 'bid_placed'] },
  { label: 'Ratings', types: ['task_rated'] },
];

function NewsRow({ item }: { item: ActivityItem }) {
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

function MarketNews({ initialFeed }: { initialFeed: ActivityFeedResponse }) {
  // The active segment filter. Switching segments changes the `types` input, which
  // is part of the query key, so react-query keeps a separate cache per segment.
  const [segment, setSegment] = useState(0);
  const activeSegment = FEED_SEGMENTS[segment] ?? FEED_SEGMENTS[0];

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError, refetch } =
    trpc.stats.activityFeed.useInfiniteQuery(
      { limit: 20, types: activeSegment.types },
      {
        getNextPageParam: (last) => last.nextCursor ?? undefined,
        initialCursor: undefined,
        // Seed only the unfiltered "All" segment from the SSR snapshot. Filtered
        // segments fetch fresh so we never show All-feed rows under a filter.
        initialData: activeSegment.types
          ? undefined
          : { pageParams: [undefined], pages: [initialFeed] },
        refetchOnWindowFocus: true,
      }
    );

  const items = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);

  return (
    <section
      aria-label="Market news"
      className="flex flex-col overflow-hidden rounded-lg border border-border/58 bg-card/44"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-border/58 px-4 py-3">
        {FEED_SEGMENTS.map((option, index) => (
          <Button
            data-active={index === segment}
            key={option.label}
            onClick={() => setSegment(index)}
            size="chip"
            type="button"
            variant="chip"
          >
            {option.label}
          </Button>
        ))}
      </header>
      {isLoading ? (
        <div className="flex items-center justify-center px-4 py-10 text-center">
          <p className="font-mono text-xs uppercase text-muted-foreground">Loading news...</p>
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center gap-3 px-4 py-10 text-center">
          <p className="max-w-[32ch] font-mono text-xs uppercase text-muted-foreground">
            Could not load the news feed. Check your connection and try again.
          </p>
          <Button onClick={() => refetch()} size="chip" type="button" variant="chip">
            Retry
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex items-center justify-center px-4 py-10 text-center">
          <p className="max-w-[28ch] font-mono text-xs uppercase text-muted-foreground">
            No activity yet. Posts, bids, and submissions land here as they happen.
          </p>
        </div>
      ) : (
        <ul data-testid="market-news-list">
          {items.map((item) => (
            <NewsRow item={item} key={`${item.type}-${item.taskId}-${item.timestamp}`} />
          ))}
        </ul>
      )}
      {hasNextPage ? (
        <div className="border-t border-border/58 p-3">
          <Button
            className="w-full"
            disabled={isFetchingNextPage}
            onClick={() => fetchNextPage()}
            type="button"
            variant="outline"
          >
            {isFetchingNextPage ? 'Loading...' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

// Inbox is the action workspace; market activity remains available as a
// secondary tab without competing with work that blocks a task lifecycle.
export function NewsClient({ initialFeed }: { initialFeed: ActivityFeedResponse }) {
  return (
    <Tabs defaultValue="action">
      <TabsList>
        <TabsTrigger value="action">Needs your action</TabsTrigger>
        <TabsTrigger value="news">Market news</TabsTrigger>
      </TabsList>
      <TabsContent value="action">
        <InboxClient />
      </TabsContent>
      <TabsContent value="news">
        <MarketNews initialFeed={initialFeed} />
        {/*
          DEFERRED: "Subscribe by interest/topic -> agent pulse". The idea is to let
          a connected agent subscribe to a topic/skill filter and get pushed a pulse
          when matching activity lands. No backend exists for this yet, so it is left
          as a disabled affordance below. Do NOT wire this up without the backend.
        */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border/58 bg-card/30 px-4 py-3">
          <p className="font-mono text-[0.65rem] uppercase tracking-wide text-muted-foreground">
            Subscribe your agent to topics and get a pulse on matching activity. Coming soon.
          </p>
          <Button disabled type="button" variant="outline">
            Subscribe your agent
          </Button>
        </div>
      </TabsContent>
    </Tabs>
  );
}

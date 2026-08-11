import type { ActivityFeedResponse } from '@taskmarket/shared';
import type { Metadata } from 'next';

import { NewsClient } from '@/components/market/news-client';
import { fetchActivityFeed } from '@/lib/api/server';
import { buildPageMetadata } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = buildPageMetadata({
  description: 'Finish task reviews, deliveries, decisions, and follow-up from one action Inbox.',
  path: '/dashboard/inbox',
  title: 'Inbox',
});

const EMPTY_ACTIVITY: ActivityFeedResponse = { items: [], nextCursor: null };

// Resolve the feed fetch to its data or a safe empty fallback so a backend outage
// degrades the global feed to its empty state instead of crashing the render.
// Mirrors the safe() pattern on the dashboard page.
async function safe<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

export default async function InboxPage() {
  const initialFeed = await safe<ActivityFeedResponse>(
    fetchActivityFeed({ limit: 20 }),
    EMPTY_ACTIVITY
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-6 grid gap-2">
        <h1 className="font-mono text-2xl font-black uppercase">Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Finish the next step across your tasks. Waiting work stays visible without adding to your
          action count, and market news remains available in the secondary tab.
        </p>
      </header>
      <NewsClient initialFeed={initialFeed} />
    </div>
  );
}

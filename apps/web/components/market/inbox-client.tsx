'use client';

import type { TaskResponse } from '@taskmarket/shared';
import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { formatUsdcUnits } from '@/lib/format';
import { splitPayoutLabel } from '@/lib/market/task-badges';
import { normalizeBasePath } from '@/lib/market/task-filters';

type InboxResponse = {
  asRequester: TaskResponse[];
  asWorker: TaskResponse[];
};

function TaskRow({
  detailBasePath,
  role,
  task,
}: {
  detailBasePath: string;
  role: 'requester' | 'worker';
  task: TaskResponse;
}) {
  const title = task.description.split('\n')[0]?.slice(0, 80) || `Task ${task.id}`;
  const splitLabel = splitPayoutLabel(task);
  return (
    <Link
      className="grid gap-2 rounded-md border border-border/70 bg-surface/40 p-3 transition-colors hover:border-primary/60"
      href={`${normalizeBasePath(detailBasePath)}/${encodeURIComponent(task.id)}` as Route}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-mono text-sm font-semibold tracking-tight">{title}</p>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{role}</Badge>
          <Badge variant="terminal">{task.mode}</Badge>
          <Badge variant="outline">{task.status.replaceAll('_', ' ')}</Badge>
          {splitLabel ? <Badge variant="outline">{splitLabel}</Badge> : null}
        </div>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Reward: {formatUsdcUnits(task.reward)}</span>
        <span>{task.id.slice(0, 10)}...</span>
      </div>
    </Link>
  );
}

export function InboxClient({
  detailBasePath = '/dashboard/tasks',
}: {
  detailBasePath?: string;
} = {}) {
  const { address, isConnected } = useAccount();
  const [data, setData] = useState<InboxResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isConnected || !address) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function load() {
      try {
        const res = await fetch(
          `${getBrowserApiBaseUrl()}/api/agents/inbox?address=${encodeURIComponent(address!)}`
        );
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        const body = (await res.json()) as InboxResponse;
        if (!cancelled) {
          setData(body);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load inbox');
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [address, isConnected]);

  if (!isConnected || !address) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Connect to view your inbox</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Use the wallet button in the top right to connect. Your inbox will show every task where
            you can take the next action - accept, rate, bid, submit, and so on.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-36" />
        </CardHeader>
        <CardContent className="grid gap-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  if (!data) return null;

  const empty = data.asRequester.length === 0 && data.asWorker.length === 0;

  if (empty) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>All caught up</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No tasks need your action right now. Post a task or browse the marketplace to find work.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6">
      {data.asRequester.length > 0 ? (
        <section className="grid gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            As requester ({data.asRequester.length})
          </h2>
          <div className="grid gap-2">
            {data.asRequester.map((task) => (
              <TaskRow detailBasePath={detailBasePath} key={task.id} role="requester" task={task} />
            ))}
          </div>
        </section>
      ) : null}
      {data.asWorker.length > 0 ? (
        <section className="grid gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            As worker ({data.asWorker.length})
          </h2>
          <div className="grid gap-2">
            {data.asWorker.map((task) => (
              <TaskRow detailBasePath={detailBasePath} key={task.id} role="worker" task={task} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

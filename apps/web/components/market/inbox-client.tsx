'use client';

import type {
  TaskActionIntentValue,
  TaskActionQueueItem,
  TaskActionQueueResponse,
  TaskActionWaitingItem,
} from '@taskmarket/shared';
import { ArrowRightIcon, CircleCheckIcon, Clock3Icon, TriangleAlertIcon } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';

import { ConnectPrompt } from '@/components/market/actions/connect-prompt';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatUsdcUnits } from '@/lib/format';
import { emitActionInboxEvent } from '@/lib/market/action-inbox-events';
import { taskTitle } from '@/lib/market/task-title';
import { useActionQueue } from '@/lib/use-action-queue';
import { useReadAuthSignature } from '@/lib/use-read-auth-signature';

const INTENT_DESCRIPTION: Record<TaskActionIntentValue, string> = {
  appeal_verdict: 'Review the verdict and supporting evidence before the appeal window closes.',
  evaluate_work: 'Review the submitted evidence and record your independent verdict.',
  finalize_verdict: 'The verdict window is complete. Finalize it to move the task forward.',
  rate_workers: 'Share feedback after settlement to complete the task relationship.',
  resolve_dispute: 'Review the task evidence and issue the dispute decision.',
  review_work: 'Review the delivered evidence before accepting, rejecting, or releasing payment.',
  select_auction_winner: 'Compare the eligible bids before assigning the work.',
  select_worker: 'Compare the pitches and choose who should complete the task.',
  settle_expired: 'Resolve the expired assignment so the task can reach a terminal state.',
  submit_work: 'Upload the requested deliverables before the task deadline.',
};

const WAITING_LABEL: Record<TaskActionWaitingItem['reason'], string> = {
  waiting_for_appeal_window: 'Waiting for appeal window',
  waiting_for_evaluator: 'Waiting for evaluator',
  waiting_for_review: 'Waiting for review',
  waiting_for_settlement: 'Settlement confirming',
  waiting_for_submissions: 'Waiting for submissions',
  waiting_for_worker: 'Waiting for worker delivery',
};

function itemTitle(item: TaskActionQueueItem): string {
  const total = item.progress?.total;
  const remaining = total ? total - (item.progress?.completed ?? 0) : null;

  switch (item.intent) {
    case 'appeal_verdict':
      return 'Review and appeal the verdict';
    case 'evaluate_work':
      return 'Evaluate submitted work';
    case 'finalize_verdict':
      return 'Finalize the verdict';
    case 'rate_workers':
      return remaining && remaining > 1 ? `Rate ${remaining} workers` : 'Rate the worker';
    case 'resolve_dispute':
      return 'Resolve the dispute';
    case 'review_work':
      return total && total > 1 ? `Review ${total} submissions` : 'Review submitted work';
    case 'select_auction_winner':
      return 'Select the auction winner';
    case 'select_worker':
      return total && total > 1
        ? `Compare ${total} pitches and select a worker`
        : 'Select a worker';
    case 'settle_expired':
      return 'Settle the expired task';
    case 'submit_work':
      return 'Submit your work';
  }
}

function actionHref(detailBasePath: string, item: TaskActionQueueItem): Route {
  const base = detailBasePath.replace(/\/+$/, '');
  const anchor =
    item.intent === 'rate_workers'
      ? 'settlement-payouts'
      : item.intent === 'submit_work'
        ? 'task-participation'
        : item.intent === 'review_work' ||
            item.intent === 'select_worker' ||
            item.intent === 'select_auction_winner'
          ? 'task-activity'
          : 'task-next-actions';
  return `${base}/${encodeURIComponent(item.task.id)}?focus=${item.intent}#${anchor}` as Route;
}

function absoluteDeadline(value: string): string {
  return new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(value));
}

function ActionRow({
  detailBasePath,
  item,
}: {
  detailBasePath: string;
  item: TaskActionQueueItem;
}) {
  return (
    <li>
      <Link
        className="group grid gap-3 rounded-lg border border-border/70 bg-card/44 p-4 transition-colors hover:border-primary/60 hover:bg-card/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        href={actionHref(detailBasePath, item)}
        onClick={() =>
          emitActionInboxEvent({
            event: 'item_opened',
            intent: item.intent,
            role: item.role,
            taskId: item.task.id,
          })
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={item.priority === 'urgent' ? 'destructive' : 'outline'}>
            {item.priority === 'urgent'
              ? 'Urgent'
              : item.priority === 'follow_up'
                ? 'Follow up'
                : 'Action required'}
          </Badge>
          <Badge variant="outline">{item.role.replaceAll('_', ' ')}</Badge>
          {item.dueAt ? (
            <span className="inline-flex items-center gap-1 font-mono text-[0.68rem] uppercase tracking-wide text-muted-foreground">
              <Clock3Icon aria-hidden="true" className="size-3.5" />
              Due {absoluteDeadline(item.dueAt)}
            </span>
          ) : null}
        </div>
        <div className="grid gap-1">
          <p className="font-mono text-sm font-bold text-primary">{itemTitle(item)}</p>
          <p className="break-words font-display text-lg font-semibold leading-tight text-foreground">
            {taskTitle(item.task)}
          </p>
          <p className="max-w-2xl text-sm leading-5 text-muted-foreground">
            {INTENT_DESCRIPTION[item.intent]}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/58 pt-3 text-xs text-muted-foreground">
          <span className="font-mono">{formatUsdcUnits(item.task.reward)} reward</span>
          <span className="inline-flex items-center gap-1 font-semibold text-foreground group-hover:text-primary">
            Open task
            <ArrowRightIcon aria-hidden="true" className="size-3.5" />
          </span>
        </div>
      </Link>
    </li>
  );
}

function WaitingRow({
  detailBasePath,
  item,
}: {
  detailBasePath: string;
  item: TaskActionWaitingItem;
}) {
  const base = detailBasePath.replace(/\/+$/, '');
  return (
    <li>
      <Link
        className="grid gap-2 rounded-lg border border-border/58 bg-surface/30 p-4 transition-colors hover:border-border hover:bg-surface/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        href={`${base}/${encodeURIComponent(item.task.id)}#task-activity` as Route}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium text-foreground">{taskTitle(item.task)}</p>
          <Badge variant="outline">{item.role.replaceAll('_', ' ')}</Badge>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Clock3Icon aria-hidden="true" className="size-3.5" />
            {WAITING_LABEL[item.reason]}
          </span>
          {item.dueAt ? <span>Next checkpoint {absoluteDeadline(item.dueAt)}</span> : null}
        </div>
      </Link>
    </li>
  );
}

function InboxLoadingState() {
  return (
    <section aria-label="Loading Inbox" className="grid gap-3">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </section>
  );
}

export function InboxQueueView({
  connected,
  data,
  detailBasePath = '/dashboard/tasks',
  isError,
  isLoading,
  onRetry,
}: {
  connected: boolean;
  data?: TaskActionQueueResponse;
  detailBasePath?: string;
  isError: boolean;
  isLoading: boolean;
  onRetry: () => void;
}) {
  if (!connected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle aria-level={2} role="heading">
            Connect to view your Inbox
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ConnectPrompt label="Sign in to see tasks that need your attention." />
        </CardContent>
      </Card>
    );
  }

  if (isLoading) return <InboxLoadingState />;

  if (isError) {
    return (
      <Card role="alert">
        <CardHeader>
          <CardTitle aria-level={2} className="flex items-center gap-2" role="heading">
            <TriangleAlertIcon aria-hidden="true" className="size-5 text-destructive" />
            Inbox unavailable
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            We could not load your task actions. Check your connection and try again.
          </p>
          <Button className="w-fit" onClick={onRetry} type="button" variant="outline">
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data) return <InboxLoadingState />;

  return (
    <div className="grid gap-8">
      <section aria-label="Needs your action" className="grid gap-3">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="font-mono text-sm font-bold uppercase tracking-wide text-foreground">
              Needs your action
            </h2>
            <p className="text-sm text-muted-foreground">
              These tasks are waiting for a decision or delivery from you.
            </p>
          </div>
          {data.total > 0 ? (
            <Badge variant={data.urgentTotal > 0 ? 'destructive' : 'outline'}>
              {data.total} {data.total === 1 ? 'action' : 'actions'}
            </Badge>
          ) : null}
        </header>
        {data.items.length > 0 ? (
          <ul className="grid gap-3">
            {data.items.map((item) => (
              <ActionRow detailBasePath={detailBasePath} item={item} key={item.id} />
            ))}
          </ul>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle aria-level={3} className="flex items-center gap-2" role="heading">
                <CircleCheckIcon aria-hidden="true" className="size-5 text-primary" />
                All caught up
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <p className="text-sm text-muted-foreground">
                No tasks need your action right now. We will keep waiting work visible below.
              </p>
              {data.waiting.length === 0 ? (
                <div className="flex flex-wrap gap-2">
                  <Button asChild>
                    <Link href={'/dashboard/tasks/new' as Route}>Post a task</Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href={'/dashboard/tasks' as Route}>Browse tasks</Link>
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        )}
      </section>

      {data.waiting.length > 0 ? (
        <section aria-label="Waiting on others" className="grid gap-3">
          <header className="grid gap-1">
            <h2 className="font-mono text-sm font-bold uppercase tracking-wide text-foreground">
              Waiting on others
            </h2>
            <p className="text-sm text-muted-foreground">
              No action is needed from you on these tasks right now.
            </p>
          </header>
          <ul className="grid gap-2">
            {data.waiting.map((item) => (
              <WaitingRow detailBasePath={detailBasePath} item={item} key={item.id} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function InboxClient({
  detailBasePath = '/dashboard/tasks',
}: {
  detailBasePath?: string;
} = {}) {
  const { address, isConnected } = useAccount();
  const readAuthReady = useReadAuthSignature(isConnected ? address : undefined);
  const query = useActionQueue(address, {
    enabled: Boolean(isConnected && address),
    readAuthReady,
  });
  const viewedRef = useRef(false);

  useEffect(() => {
    if (!query.data || viewedRef.current) return;
    viewedRef.current = true;
    emitActionInboxEvent({
      actionCount: query.data.total,
      event: 'queue_viewed',
      waitingCount: query.data.waiting.length,
    });
  }, [query.data]);

  return (
    <InboxQueueView
      connected={Boolean(isConnected && address)}
      data={query.data}
      detailBasePath={detailBasePath}
      isError={query.isError}
      isLoading={query.isLoading}
      onRetry={() => void query.refetch()}
    />
  );
}

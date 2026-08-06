'use client';

import {
  AlertCircleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CircleCheckIcon,
  Clock3Icon,
  FileArchiveIcon,
  FileTextIcon,
  PlugZapIcon,
  UploadCloudIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export type InboxMailPrototypeMessage = {
  dueLabel?: string;
  id: string;
  kind: 'rate' | 'review' | 'submit' | 'waiting';
  priority: 'follow_up' | 'required' | 'urgent' | 'waiting';
  rewardLabel: string;
  role: 'requester' | 'worker';
  subject: string;
  taskTitle: string;
};

const REVIEW_SUBMISSIONS = [
  {
    file: 'settlement-workflow.pdf',
    meta: '12 pages · 1.4 MB',
    submitted: 'Aug 6, 14:32 UTC',
    worker: '0x7421…b3fA',
  },
  {
    file: 'state-transitions.pdf',
    meta: '9 pages · 1.1 MB',
    submitted: 'Aug 6, 16:05 UTC',
    worker: '0x9c11…2d7B',
  },
  {
    file: 'settlement-audit.pdf',
    meta: '15 pages · 1.9 MB',
    submitted: 'Aug 6, 18:41 UTC',
    worker: '0x1a7F…8c9E',
  },
] as const;

function PriorityBadge({ priority }: { priority: InboxMailPrototypeMessage['priority'] }) {
  if (priority === 'urgent') {
    return (
      <Badge className="text-foreground" variant="destructive">
        Urgent
      </Badge>
    );
  }
  if (priority === 'follow_up') {
    return <Badge variant="outline">Follow up</Badge>;
  }
  if (priority === 'waiting') {
    return <Badge variant="terminal">Waiting</Badge>;
  }
  return <Badge variant="outline">Action required</Badge>;
}

function MessageRow({
  buttonRef,
  message,
  onSelect,
  selected,
}: {
  buttonRef: (node: HTMLButtonElement | null) => void;
  message: InboxMailPrototypeMessage;
  onSelect: () => void;
  selected: boolean;
}) {
  return (
    <li>
      <button
        aria-current={selected ? 'true' : undefined}
        ref={buttonRef}
        className={cn(
          'grid w-full gap-3 rounded-lg border p-4 text-left transition-[background-color,border-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          selected
            ? 'border-primary/64 bg-primary/8'
            : 'border-border/58 bg-card/44 hover:border-primary/36 hover:bg-card/58'
        )}
        onClick={onSelect}
        type="button"
      >
        <div className="flex flex-wrap items-center gap-2">
          <PriorityBadge priority={message.priority} />
          <Badge variant="outline">{message.role}</Badge>
          {message.dueLabel ? (
            <span className="ml-auto inline-flex items-center gap-1 font-mono text-[0.68rem] uppercase tracking-wide text-muted-foreground">
              <Clock3Icon aria-hidden="true" className="size-3.5" />
              {message.dueLabel}
            </span>
          ) : null}
        </div>
        <div className="grid min-w-0 gap-1">
          <p className="font-mono text-sm font-bold text-foreground dark:text-primary">
            {message.subject}
          </p>
          <p className="line-clamp-2 font-display text-base font-semibold leading-snug text-foreground">
            {message.taskTitle}
          </p>
        </div>
        <p className="border-t border-border/58 pt-3 font-mono text-xs text-muted-foreground">
          {message.rewardLabel}
        </p>
      </button>
    </li>
  );
}

function DetailHeader({ message }: { message: InboxMailPrototypeMessage }) {
  return (
    <header className="grid gap-4 border-b border-border/58 px-5 py-5 sm:px-7 sm:py-6">
      <div className="grid gap-1.5">
        <h2 className="font-mono text-sm font-bold text-primary">{message.subject}</h2>
        <p className="max-w-4xl font-display text-2xl font-semibold leading-tight text-foreground sm:text-3xl">
          {message.taskTitle}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{message.role}</Badge>
        <PriorityBadge priority={message.priority} />
        {message.dueLabel ? (
          <span className="inline-flex items-center gap-1 font-mono text-[0.68rem] uppercase tracking-wide text-muted-foreground">
            <Clock3Icon aria-hidden="true" className="size-3.5" />
            {message.dueLabel}
          </span>
        ) : null}
        <span className="font-mono text-xs text-muted-foreground">{message.rewardLabel}</span>
      </div>
    </header>
  );
}

function ReviewDetail() {
  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <h3 className="font-mono text-xs font-bold uppercase tracking-wide text-primary">
          Why this needs you
        </h3>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Three workers submitted evidence. Review each delivery before accepting, rejecting, or
          releasing payment.
        </p>
      </div>
      <section aria-labelledby="submission-evidence-heading" className="grid gap-2">
        <h3 className="sr-only" id="submission-evidence-heading">
          Submission evidence
        </h3>
        {REVIEW_SUBMISSIONS.map((submission) => (
          <article
            className="grid gap-3 rounded-md border border-border/58 bg-background/32 p-3 sm:grid-cols-[minmax(8rem,0.75fr)_minmax(9rem,0.9fr)_minmax(12rem,1.35fr)_auto] sm:items-center"
            key={submission.worker}
          >
            <div className="min-w-0">
              <p className="font-mono text-xs font-semibold text-foreground">{submission.worker}</p>
              <p className="mt-1 text-xs text-muted-foreground">Worker submission</p>
            </div>
            <div>
              <p className="font-mono text-[0.65rem] uppercase tracking-wide text-primary">
                Submitted
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{submission.submitted}</p>
            </div>
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-md border border-border/58 bg-surface/58 text-primary">
                <FileTextIcon aria-hidden="true" className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{submission.file}</p>
                <p className="text-xs text-muted-foreground">{submission.meta}</p>
              </div>
            </div>
            <Button size="xs" type="button" variant="ghost">
              View evidence
              <ArrowRightIcon aria-hidden="true" />
            </Button>
          </article>
        ))}
      </section>
    </div>
  );
}

function DetailFooter({ kind }: { kind: InboxMailPrototypeMessage['kind'] }) {
  if (kind === 'review') {
    return (
      <footer className="flex flex-wrap items-center gap-3 border-t border-border/58 bg-card/44 px-5 py-4 sm:px-7">
        <p className="mr-auto flex max-w-sm items-start gap-2 text-xs leading-5 text-muted-foreground">
          <AlertCircleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
          Accepting marks the task complete and releases payment to the selected worker.
        </p>
        <Button type="button">Accept submission</Button>
        <Button type="button" variant="outline">
          Reject
        </Button>
        <Button asChild variant="link">
          <Link href="/dashboard/tasks/task-review?focus=review_work#task-activity">
            Open full task
            <ArrowRightIcon aria-hidden="true" />
          </Link>
        </Button>
      </footer>
    );
  }

  if (kind === 'submit') {
    return (
      <footer className="flex flex-wrap items-center gap-3 border-t border-border/58 bg-card/44 px-5 py-4 sm:px-7">
        <Button type="button">Submit work</Button>
        <Button asChild variant="link">
          <Link href="/dashboard/tasks/task-delivery?focus=submit_work#task-participation">
            Open full task
            <ArrowRightIcon aria-hidden="true" />
          </Link>
        </Button>
        <p className="basis-full text-xs text-muted-foreground">
          This item remains in your Inbox until the submission is recorded.
        </p>
      </footer>
    );
  }

  if (kind === 'rate') {
    return (
      <footer className="border-t border-border/58 bg-card/44 px-5 py-4 sm:px-7">
        <Button asChild variant="link">
          <Link href="/dashboard/tasks/task-rating?focus=rate_workers#settlement-payouts">
            Open full task
            <ArrowRightIcon aria-hidden="true" />
          </Link>
        </Button>
      </footer>
    );
  }

  return (
    <footer className="border-t border-border/58 bg-card/44 px-5 py-4 sm:px-7">
      <Button asChild variant="link">
        <Link href="/dashboard/tasks/task-waiting#task-activity">
          Open full task
          <ArrowRightIcon aria-hidden="true" />
        </Link>
      </Button>
    </footer>
  );
}

function SubmitDetail() {
  return (
    <div className="grid gap-5">
      <div className="grid gap-1.5">
        <h3 className="font-mono text-xs font-bold uppercase tracking-wide text-primary">
          Why this needs you
        </h3>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          You are assigned to deliver the responsive launch-page implementation before the task
          deadline.
        </p>
      </div>
      <section aria-labelledby="delivery-checklist-heading" className="grid gap-2">
        <h3
          className="font-mono text-xs font-bold uppercase tracking-wide text-primary"
          id="delivery-checklist-heading"
        >
          Task brief and checklist
        </h3>
        <ul className="grid gap-1.5 text-sm text-muted-foreground">
          {[
            'Implement responsive breakpoints for the launch page.',
            'Preserve visible focus and complete keyboard access.',
            'Honor reduced-motion preferences.',
            'Include verification evidence with the delivery.',
          ].map((item) => (
            <li className="flex items-start gap-2" key={item}>
              <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 bg-primary" />
              {item}
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="upload-evidence-heading" className="grid gap-2">
        <h3
          className="font-mono text-xs font-bold uppercase tracking-wide text-primary"
          id="upload-evidence-heading"
        >
          Upload evidence
        </h3>
        <button
          className="flex min-h-28 w-full items-center gap-4 rounded-lg border border-dashed border-primary/58 bg-primary/8 p-4 text-left transition-colors hover:bg-primary/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          type="button"
        >
          <span className="grid size-12 shrink-0 place-items-center rounded-md border border-primary/36 bg-background/52 text-primary">
            <UploadCloudIcon aria-hidden="true" className="size-6" />
          </span>
          <span>
            <span className="block font-mono text-sm font-bold text-primary">Add deliverables</span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
              Choose files or drag them here. Include the implementation and verification evidence.
            </span>
          </span>
        </button>
        <div className="flex items-center gap-3 rounded-md border border-border/58 bg-background/32 p-3">
          <FileArchiveIcon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              responsive-launch-page.zip
            </p>
            <p className="text-xs text-muted-foreground">48.2 MB · Added just now</p>
          </div>
        </div>
        <label className="mt-2 grid gap-2 font-mono text-xs font-bold uppercase tracking-wide text-primary">
          Evidence notes (optional)
          <Textarea
            className="font-sans font-normal normal-case tracking-normal"
            placeholder="Add test steps or context for review"
          />
        </label>
      </section>
    </div>
  );
}

function RatingDetail() {
  return (
    <div className="grid gap-5">
      <div className="grid gap-1.5">
        <h3 className="font-mono text-xs font-bold uppercase tracking-wide text-primary">
          Why this needs you
        </h3>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Settlement is complete. Two payout recipients still need feedback before this relationship
          is fully wrapped up.
        </p>
      </div>
      <div className="rounded-lg border border-border/58 bg-background/32 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="font-display font-semibold text-foreground">Rating progress</p>
          <Badge variant="outline">1 of 3 recorded</Badge>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/3 bg-primary" />
        </div>
      </div>
      {['0x7421…b3fA', '0x9c11…2d7B'].map((worker) => (
        <article
          className="flex flex-wrap items-center gap-3 rounded-md border border-border/58 bg-background/32 p-4"
          key={worker}
        >
          <div className="mr-auto">
            <p className="font-mono text-sm font-semibold text-foreground">{worker}</p>
            <p className="mt-1 text-xs text-muted-foreground">Settlement recipient</p>
          </div>
          <Button type="button" variant="outline">
            Rate worker
          </Button>
        </article>
      ))}
    </div>
  );
}

function WaitingDetail() {
  return (
    <div className="grid gap-5">
      <div className="grid gap-1.5">
        <h3 className="font-mono text-xs font-bold uppercase tracking-wide text-primary">
          Current state
        </h3>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          This task is waiting for submissions. No action is needed from you right now.
        </p>
      </div>
      <div className="rounded-lg border border-border/58 bg-background/32 p-5">
        <div className="flex items-start gap-3">
          <Clock3Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
          <div>
            <p className="font-display font-semibold text-foreground">Waiting for submissions</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              The next checkpoint is Aug 14. This message remains visible but does not contribute to
              the Inbox action count.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageDetail({
  message,
  onBack,
}: {
  message: InboxMailPrototypeMessage;
  onBack: () => void;
}) {
  return (
    <article className="flex min-h-0 flex-1 flex-col bg-card/44" aria-label={message.subject}>
      <div className="border-b border-border/58 px-4 py-3 md:hidden">
        <Button onClick={onBack} size="sm" type="button" variant="ghost">
          <ArrowLeftIcon aria-hidden="true" />
          Back to Inbox
        </Button>
      </div>
      <DetailHeader message={message} />
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-5 py-5 sm:px-7 sm:py-6">
          {message.kind === 'review' ? (
            <ReviewDetail />
          ) : message.kind === 'submit' ? (
            <SubmitDetail />
          ) : message.kind === 'rate' ? (
            <RatingDetail />
          ) : (
            <WaitingDetail />
          )}
        </div>
      </ScrollArea>
      <DetailFooter kind={message.kind} />
    </article>
  );
}

export function InboxMailWorkspacePrototype({
  initialSelectedId,
  messages,
  startOnList = false,
  status = 'ready',
}: {
  initialSelectedId?: string;
  messages: InboxMailPrototypeMessage[];
  startOnList?: boolean;
  status?: 'disconnected' | 'error' | 'loading' | 'ready';
}) {
  const [currentStatus, setCurrentStatus] = useState(status);
  const [selectedId, setSelectedId] = useState<string | null>(
    startOnList ? null : (initialSelectedId ?? messages[0]?.id ?? null)
  );
  const [activeView, setActiveView] = useState<'action' | 'waiting'>('action');
  const messageButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const lastSelectedIdRef = useRef<string | null>(selectedId);
  const actionMessages = messages.filter((message) => message.kind !== 'waiting');
  const waitingMessages = messages.filter((message) => message.kind === 'waiting');
  const visibleMessages = activeView === 'action' ? actionMessages : waitingMessages;
  const selected = visibleMessages.find((message) => message.id === selectedId) ?? null;

  useEffect(() => setCurrentStatus(status), [status]);

  useEffect(() => {
    if (selectedId !== null || !lastSelectedIdRef.current) return;
    messageButtonsRef.current.get(lastSelectedIdRef.current)?.focus();
  }, [selectedId]);

  function selectMessage(messageId: string) {
    lastSelectedIdRef.current = messageId;
    setSelectedId(messageId);
  }

  function selectView(view: 'action' | 'waiting') {
    const nextMessages = view === 'action' ? actionMessages : waitingMessages;
    const nextSelectedId = startOnList ? null : (nextMessages[0]?.id ?? null);
    setActiveView(view);
    lastSelectedIdRef.current = nextSelectedId;
    setSelectedId(nextSelectedId);
  }

  return (
    <div
      className="min-h-[42rem] bg-background text-foreground"
      style={{ height: 'calc(var(--app-viewport-height) - 3rem)' }}
    >
      <div
        aria-label="Mail-style Action Inbox prototype"
        className="mx-auto flex h-full w-full max-w-[96rem] flex-col overflow-hidden rounded-lg border border-border/58 bg-surface/44"
        role="group"
      >
        <div className="flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/58 bg-card/44 px-4 py-3 sm:px-6">
          <button
            aria-pressed={activeView === 'action'}
            className="border-b-2 border-transparent px-3 py-3 font-mono text-xs font-bold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-primary aria-pressed:text-primary"
            onClick={() => selectView('action')}
            type="button"
          >
            Needs action <span className="ml-2">{actionMessages.length}</span>
          </button>
          <button
            aria-pressed={activeView === 'waiting'}
            className="border-b-2 border-transparent px-3 py-3 font-mono text-xs font-bold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-primary aria-pressed:text-primary"
            onClick={() => selectView('waiting')}
            type="button"
          >
            Waiting <span className="ml-2">{waitingMessages.length}</span>
          </button>
          <Button asChild className="ml-auto" size="sm" variant="ghost">
            <Link href="/dashboard/inbox?tab=news">Market activity</Link>
          </Button>
        </div>
        {currentStatus === 'loading' ? (
          <div
            aria-label="Loading Inbox workspace"
            className="grid min-h-0 flex-1 gap-5 p-5 md:grid-cols-[minmax(14rem,0.8fr)_minmax(0,1.2fr)] sm:p-7"
            role="region"
          >
            <div className="grid content-start gap-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
            <div className="hidden content-start gap-5 md:grid">
              <Skeleton className="h-20 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-56 w-full" />
            </div>
          </div>
        ) : currentStatus === 'disconnected' ? (
          <div className="grid min-h-0 flex-1 place-items-center p-6 text-center">
            <div className="grid max-w-md justify-items-center gap-4 rounded-lg border border-border/58 bg-card/44 p-7">
              <span className="grid size-12 place-items-center rounded-md border border-primary/36 bg-primary/8 text-primary">
                <PlugZapIcon aria-hidden="true" className="size-6" />
              </span>
              <div className="grid gap-2">
                <h2 className="font-display text-2xl font-semibold text-foreground">
                  Connect to view your Inbox
                </h2>
                <p className="text-sm leading-6 text-muted-foreground">
                  Sign in with your wallet to see task decisions, deliveries, and follow-ups that
                  need your attention.
                </p>
              </div>
              <Button type="button">Connect wallet</Button>
            </div>
          </div>
        ) : currentStatus === 'error' ? (
          <div className="grid min-h-0 flex-1 place-items-center p-6 text-center">
            <div
              className="grid max-w-md justify-items-center gap-4 rounded-lg border border-destructive/36 bg-card/44 p-7"
              role="alert"
            >
              <AlertCircleIcon aria-hidden="true" className="size-8 text-destructive" />
              <div className="grid gap-2">
                <h2 className="font-display text-2xl font-semibold text-foreground">
                  Inbox unavailable
                </h2>
                <p className="text-sm leading-6 text-muted-foreground">
                  We could not load your task actions. Check your connection and try again.
                </p>
              </div>
              <Button onClick={() => setCurrentStatus('ready')} type="button" variant="outline">
                Retry
              </Button>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="grid min-h-0 flex-1 place-items-center p-6 text-center">
            <div className="grid max-w-md justify-items-center gap-4 rounded-lg border border-border/58 bg-card/44 p-7">
              <span className="grid size-12 place-items-center rounded-md border border-primary/36 bg-primary/8 text-primary">
                <CircleCheckIcon aria-hidden="true" className="size-6" />
              </span>
              <div className="grid gap-2">
                <h2 className="font-display text-2xl font-semibold text-foreground">
                  All caught up
                </h2>
                <p className="text-sm leading-6 text-muted-foreground">
                  No tasks need your action right now. New decisions and deliveries will appear here
                  when they are ready.
                </p>
              </div>
              <Button asChild variant="outline">
                <Link href="/dashboard/tasks">Browse tasks</Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(14rem,0.8fr)_minmax(0,1.2fr)]">
            <nav
              aria-label="Inbox messages"
              className={cn(
                'min-h-0 flex-col border-border/58 bg-background/32 md:flex md:border-r',
                selected ? 'hidden' : 'flex'
              )}
            >
              <ScrollArea className="min-h-0 flex-1">
                <div className="border-b border-border/58 px-4 py-3">
                  <p className="text-xs leading-5 text-muted-foreground">
                    {activeView === 'action'
                      ? 'Finish these actions to clear your Inbox.'
                      : 'No action is needed from you right now.'}
                  </p>
                </div>
                <ul className="grid gap-2 p-3 sm:p-4">
                  {visibleMessages.map((message) => (
                    <MessageRow
                      buttonRef={(node) => {
                        if (node) messageButtonsRef.current.set(message.id, node);
                        else messageButtonsRef.current.delete(message.id);
                      }}
                      key={message.id}
                      message={message}
                      onSelect={() => selectMessage(message.id)}
                      selected={message.id === selectedId}
                    />
                  ))}
                </ul>
              </ScrollArea>
            </nav>
            <div className={cn('min-h-0 flex-col', selected ? 'flex' : 'hidden md:flex')}>
              {selected ? (
                <MessageDetail message={selected} onBack={() => setSelectedId(null)} />
              ) : (
                <div className="grid flex-1 place-items-center p-8 text-center text-muted-foreground">
                  <p>Select a message to review its task context and next action.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

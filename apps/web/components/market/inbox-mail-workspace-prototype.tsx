'use client';

import type { TaskActionQueueItem, TaskActionWaitingItem } from '@taskmarket/shared';
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
import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useRef, useState, type Ref } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { formatUsdcUnits } from '@/lib/format';
import { taskActionHref, taskActionTitle } from '@/lib/market/task-action-presentation';
import { taskFullTitle, taskTitle } from '@/lib/market/task-title';
import { cn } from '@/lib/utils';

type PrototypeActionIntent = 'rate_workers' | 'review_work' | 'submit_work';

type InboxMailPrototypeAction = TaskActionQueueItem & { intent: PrototypeActionIntent };
type InboxMailPrototypeWaiting = TaskActionWaitingItem & { reason: 'waiting_for_submissions' };

export type InboxMailPrototypeMessage = InboxMailPrototypeAction | InboxMailPrototypeWaiting;

const REVIEW_SUBMISSIONS = [
  {
    file: 'settlement-workflow.pdf',
    meta: '12 pages · 1.4 MB',
    submitted: 'Aug 6, 14:32 UTC',
    worker: '0x7421…b3fA',
  },
  {
    file: 'complete-state-transition-audit-with-requester-worker-evaluator-and-dispute-annotations.pdf',
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

function isActionMessage(message: InboxMailPrototypeMessage): message is InboxMailPrototypeAction {
  return 'intent' in message;
}

function messageSubject(message: InboxMailPrototypeMessage): string {
  return isActionMessage(message)
    ? taskActionTitle(message.intent, message.progress)
    : 'Waiting for submissions';
}

function messageDueLabel(message: InboxMailPrototypeMessage): string | null {
  if (!message.dueAt) return null;
  const deadline = new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(message.dueAt));
  return isActionMessage(message) ? `Due ${deadline}` : `Next checkpoint ${deadline}`;
}

function messageRewardLabel(message: InboxMailPrototypeMessage): string {
  return isActionMessage(message)
    ? `${formatUsdcUnits(message.task.reward)} reward`
    : 'Waiting for submissions';
}

function PriorityBadge({ message }: { message: InboxMailPrototypeMessage }) {
  if (!isActionMessage(message)) {
    return <Badge variant="terminal">Waiting</Badge>;
  }
  const { priority } = message;
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
  const dueLabel = messageDueLabel(message);
  const subject = messageSubject(message);

  return (
    <li>
      <button
        aria-current={selected ? 'true' : undefined}
        ref={buttonRef}
        className={cn(
          'grid min-h-28 w-full gap-2 border-l-2 px-4 py-4 text-left transition-[background-color,border-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none',
          selected ? 'border-l-primary bg-primary/8' : 'border-l-transparent hover:bg-card/58'
        )}
        onClick={onSelect}
        type="button"
      >
        <div className="flex min-w-0 items-center gap-2">
          <p className="min-w-0 truncate font-mono text-xs font-bold text-foreground dark:text-primary">
            {subject}
          </p>
          <span className="ml-auto shrink-0">
            <PriorityBadge message={message} />
          </span>
        </div>
        <p className="line-clamp-2 font-display text-base font-semibold leading-snug text-foreground">
          {taskTitle(message.task)}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.68rem] uppercase tracking-wide text-muted-foreground">
          <span>{message.role}</span>
          {dueLabel ? (
            <span className="inline-flex items-center gap-1">
              <Clock3Icon aria-hidden="true" className="size-3.5" />
              {dueLabel}
            </span>
          ) : null}
          <span>{messageRewardLabel(message)}</span>
        </div>
      </button>
    </li>
  );
}

function DetailHeader({ message }: { message: InboxMailPrototypeMessage }) {
  const dueLabel = messageDueLabel(message);

  return (
    <header className="grid shrink-0 gap-3 border-b border-border/58 px-5 py-4 sm:px-7 sm:py-5">
      <div className="grid gap-1.5">
        <h2 className="font-mono text-sm font-bold text-primary">{messageSubject(message)}</h2>
        <p className="max-w-4xl font-display text-2xl font-semibold leading-tight text-foreground xl:text-3xl">
          {taskFullTitle(message.task)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{message.role}</Badge>
        <PriorityBadge message={message} />
        {dueLabel ? (
          <span className="inline-flex items-center gap-1 font-mono text-[0.68rem] uppercase tracking-wide text-muted-foreground">
            <Clock3Icon aria-hidden="true" className="size-3.5" />
            {dueLabel}
          </span>
        ) : null}
        <span className="font-mono text-xs text-muted-foreground">
          {messageRewardLabel(message)}
        </span>
      </div>
    </header>
  );
}

function ReviewDetail({
  onSelectWorker,
  selectedWorker,
}: {
  onSelectWorker: (worker: string) => void;
  selectedWorker: string | null;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <h3 className="font-display text-sm font-semibold text-foreground">Why this needs you</h3>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Three workers submitted evidence. Review each delivery before accepting, rejecting, or
          releasing payment.
        </p>
      </div>
      <section aria-labelledby="submission-evidence-heading" className="grid gap-2">
        <h3 className="sr-only" id="submission-evidence-heading">
          Submission evidence
        </h3>
        {REVIEW_SUBMISSIONS.map((submission) => {
          const selected = selectedWorker === submission.worker;

          return (
            <article
              className={cn(
                'grid items-center gap-2 rounded-md border p-2 transition-[background-color,border-color] motion-reduce:transition-none sm:grid-cols-[minmax(0,1fr)_auto]',
                selected
                  ? 'border-primary/64 bg-primary/8'
                  : 'border-border/58 bg-background/32 hover:border-primary/36'
              )}
              key={submission.worker}
            >
              <button
                aria-label={`Select submission from ${submission.worker}: ${submission.file}`}
                aria-pressed={selected}
                className="grid min-h-14 min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-sm px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onSelectWorker(submission.worker)}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid size-5 place-items-center rounded-full border',
                    selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
                  )}
                >
                  {selected ? <CircleCheckIcon className="size-4" /> : null}
                </span>
                <span className="grid min-w-0 gap-2 lg:grid-cols-[minmax(7rem,0.65fr)_minmax(8rem,0.75fr)_minmax(10rem,1.35fr)] lg:items-center">
                  <span className="min-w-0">
                    <span className="block font-mono text-xs font-semibold text-foreground">
                      {submission.worker}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      Worker submission
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">{submission.submitted}</span>
                  <span className="flex min-w-0 items-center gap-2">
                    <FileTextIcon aria-hidden="true" className="size-4 shrink-0 text-primary" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {submission.file}
                      </span>
                      <span className="block text-xs text-muted-foreground">{submission.meta}</span>
                    </span>
                  </span>
                </span>
              </button>
              <Button
                className="min-h-11 justify-start sm:justify-center"
                type="button"
                variant="ghost"
              >
                View evidence
                <ArrowRightIcon aria-hidden="true" />
              </Button>
            </article>
          );
        })}
      </section>
    </div>
  );
}

function messageHref(message: InboxMailPrototypeMessage): Route {
  return isActionMessage(message)
    ? (taskActionHref('/dashboard/tasks', message.task.id, message.intent) as Route)
    : (`/dashboard/tasks/${encodeURIComponent(message.task.id)}#task-activity` as Route);
}

function DetailFooter({
  message,
  selectedWorker,
}: {
  message: InboxMailPrototypeMessage;
  selectedWorker: string | null;
}) {
  const href = messageHref(message);

  if (isActionMessage(message) && message.intent === 'review_work') {
    const reward = formatUsdcUnits(message.task.reward);

    return (
      <footer className="sticky bottom-0 z-10 mt-auto flex shrink-0 items-center justify-end gap-2 border-t border-border/58 bg-card/95 px-3 py-3 backdrop-blur-sm sm:px-7 xl:static">
        <p className="mr-auto hidden max-w-sm items-start gap-2 text-xs leading-5 text-muted-foreground sm:flex">
          <AlertCircleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
          {selectedWorker
            ? `Accepting completes the task and releases ${reward} to ${selectedWorker}.`
            : 'Select a submission before accepting or rejecting work.'}
        </p>
        <Button asChild className="min-h-11" variant="ghost">
          <Link href={href}>Full task</Link>
        </Button>
        <Button
          aria-label={
            selectedWorker ? `Reject ${selectedWorker}` : 'Select a submission before rejecting'
          }
          disabled={!selectedWorker}
          className="min-h-11"
          type="button"
          variant="outline"
        >
          Reject
        </Button>
        <Button
          aria-label={
            selectedWorker
              ? `Accept ${selectedWorker} and release ${reward}`
              : 'Select a submission first'
          }
          disabled={!selectedWorker}
          className="min-h-11"
          type="button"
        >
          {selectedWorker ? 'Accept' : 'Select submission'}
        </Button>
      </footer>
    );
  }

  if (isActionMessage(message) && message.intent === 'submit_work') {
    return (
      <footer className="sticky bottom-0 z-10 mt-auto flex shrink-0 items-center justify-end gap-2 border-t border-border/58 bg-card/95 px-3 py-3 backdrop-blur-sm sm:px-7 xl:static">
        <p className="mr-auto hidden max-w-sm text-xs leading-5 text-muted-foreground sm:block">
          This item remains in your Inbox until the submission is recorded.
        </p>
        <Button asChild className="min-h-11" variant="ghost">
          <Link href={href}>Full task</Link>
        </Button>
        <Button className="min-h-11" type="button">
          Submit work
        </Button>
      </footer>
    );
  }

  if (isActionMessage(message)) {
    return (
      <footer className="sticky bottom-0 z-10 mt-auto flex shrink-0 justify-end border-t border-border/58 bg-card/95 px-5 py-3 backdrop-blur-sm sm:px-7 xl:static">
        <Button asChild className="min-h-11" variant="ghost">
          <Link href={href}>
            Full task
            <ArrowRightIcon aria-hidden="true" />
          </Link>
        </Button>
      </footer>
    );
  }

  return (
    <footer className="sticky bottom-0 z-10 mt-auto flex shrink-0 justify-end border-t border-border/58 bg-card/95 px-5 py-3 backdrop-blur-sm sm:px-7 xl:static">
      <Button asChild className="min-h-11" variant="ghost">
        <Link href={href}>
          Full task
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
        <h3 className="font-display text-sm font-semibold text-foreground">Why this needs you</h3>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          You are assigned to deliver the responsive launch-page implementation before the task
          deadline.
        </p>
      </div>
      <section aria-labelledby="delivery-checklist-heading" className="grid gap-2">
        <h3
          className="font-display text-sm font-semibold text-foreground"
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
          className="font-display text-sm font-semibold text-foreground"
          id="upload-evidence-heading"
        >
          Upload evidence
        </h3>
        <button
          className="flex min-h-28 w-full items-center gap-4 rounded-lg border border-dashed border-primary/58 bg-primary/8 p-4 text-left transition-colors hover:bg-primary/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
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
        <label className="mt-2 grid gap-2 text-sm font-semibold text-foreground">
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
        <h3 className="font-display text-sm font-semibold text-foreground">Why this needs you</h3>
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
    <div className="flex max-w-2xl items-start gap-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
        <Clock3Icon aria-hidden="true" className="size-5" />
      </span>
      <div className="grid gap-1.5">
        <h3 className="font-display text-sm font-semibold text-foreground">Next checkpoint</h3>
        <time className="font-mono text-lg font-semibold text-foreground" dateTime="2026-08-14">
          Aug 14
        </time>
        <p className="text-sm leading-6 text-muted-foreground">
          No action is needed now. This message stays in Waiting so you can track the task without
          adding to your action count.
        </p>
      </div>
    </div>
  );
}

function MessageDetail({
  backButtonRef,
  message,
  onBack,
}: {
  backButtonRef: Ref<HTMLButtonElement>;
  message: InboxMailPrototypeMessage;
  onBack: () => void;
}) {
  const [selectedWorker, setSelectedWorker] = useState<string | null>(null);

  useEffect(() => setSelectedWorker(null), [message.id]);

  return (
    <article
      className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-card/72 xl:overflow-hidden"
      aria-label={messageSubject(message)}
    >
      <div className="shrink-0 border-b border-border/58 px-3 py-2 xl:hidden">
        <Button
          className="min-h-11"
          ref={backButtonRef}
          onClick={onBack}
          type="button"
          variant="ghost"
        >
          <ArrowLeftIcon aria-hidden="true" />
          Back to Inbox
        </Button>
      </div>
      <DetailHeader message={message} />
      <div className="px-5 py-5 sm:px-7 sm:py-6 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
        {isActionMessage(message) && message.intent === 'review_work' ? (
          <ReviewDetail onSelectWorker={setSelectedWorker} selectedWorker={selectedWorker} />
        ) : isActionMessage(message) && message.intent === 'submit_work' ? (
          <SubmitDetail />
        ) : isActionMessage(message) ? (
          <RatingDetail />
        ) : (
          <WaitingDetail />
        )}
      </div>
      <DetailFooter message={message} selectedWorker={selectedWorker} />
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
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const messageButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const lastSelectedIdRef = useRef<string | null>(selectedId);
  const actionMessages = messages.filter(isActionMessage);
  const waitingMessages = messages.filter(
    (message): message is InboxMailPrototypeWaiting => !isActionMessage(message)
  );
  const visibleMessages = activeView === 'action' ? actionMessages : waitingMessages;
  const selected = visibleMessages.find((message) => message.id === selectedId) ?? null;

  useEffect(() => setCurrentStatus(status), [status]);

  useEffect(() => {
    if (selectedId !== null) {
      backButtonRef.current?.focus();
      return;
    }
    if (!lastSelectedIdRef.current) return;
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
        <div
          className={cn(
            'min-h-16 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/58 bg-card/72 px-4 py-2 sm:px-6',
            selected ? 'hidden xl:flex' : 'flex'
          )}
        >
          <button
            aria-pressed={activeView === 'action'}
            className="min-h-11 border-b-2 border-transparent px-3 py-2 font-mono text-xs font-bold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none aria-pressed:border-primary aria-pressed:text-primary"
            onClick={() => selectView('action')}
            type="button"
          >
            Needs action <span className="ml-2">{actionMessages.length}</span>
          </button>
          <button
            aria-pressed={activeView === 'waiting'}
            className="min-h-11 border-b-2 border-transparent px-3 py-2 font-mono text-xs font-bold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none aria-pressed:border-primary aria-pressed:text-primary"
            onClick={() => selectView('waiting')}
            type="button"
          >
            Waiting <span className="ml-2">{waitingMessages.length}</span>
          </button>
          <Button asChild className="ml-auto min-h-11" variant="ghost">
            <Link href="/dashboard/inbox?tab=news">Market activity</Link>
          </Button>
        </div>
        {currentStatus === 'loading' ? (
          <div
            aria-label="Loading Inbox workspace"
            className="grid min-h-0 flex-1 gap-5 p-5 sm:p-7 xl:grid-cols-[minmax(22rem,26rem)_minmax(0,1fr)]"
            role="region"
          >
            <div className="grid content-start gap-3">
              <Skeleton className="h-24 w-full motion-reduce:animate-none" />
              <Skeleton className="h-32 w-full motion-reduce:animate-none" />
              <Skeleton className="h-32 w-full motion-reduce:animate-none" />
            </div>
            <div className="hidden content-start gap-5 xl:grid">
              <Skeleton className="h-20 w-3/4 motion-reduce:animate-none" />
              <Skeleton className="h-4 w-full motion-reduce:animate-none" />
              <Skeleton className="h-4 w-5/6 motion-reduce:animate-none" />
              <Skeleton className="h-56 w-full motion-reduce:animate-none" />
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
            <div className="grid max-w-md justify-items-center gap-5 px-4 py-8">
              <span className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
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
              <div className="flex flex-wrap justify-center gap-2">
                <Button asChild className="min-h-11" variant="outline">
                  <Link href="/dashboard/tasks">Browse tasks</Link>
                </Button>
                <Button asChild className="min-h-11" variant="ghost">
                  <Link href="/dashboard/inbox?tab=news">Market activity</Link>
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(22rem,26rem)_minmax(0,1fr)]">
            <nav
              aria-label="Inbox messages"
              className={cn(
                'min-h-0 flex-col border-border/58 bg-background xl:flex xl:border-r',
                selected ? 'hidden' : 'flex'
              )}
            >
              <ScrollArea className="min-h-0 flex-1">
                <ul className="divide-y divide-border/58">
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
            <div className={cn('min-h-0 flex-col', selected ? 'flex' : 'hidden xl:flex')}>
              {selected ? (
                <MessageDetail
                  backButtonRef={backButtonRef}
                  message={selected}
                  onBack={() => setSelectedId(null)}
                />
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

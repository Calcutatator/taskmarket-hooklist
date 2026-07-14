'use client';

import { IconCheck, IconChevronDown, IconMinus, IconX } from '@tabler/icons-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useAccount } from 'wagmi';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/api/client';
import { cn } from '@/lib/utils';

import {
  createDefaultFirstRunState,
  deriveFirstRunProgress,
  FIRST_RUN_POINTS,
  FIRST_RUN_TOTAL_POINTS,
  mergeFirstRunCompletion,
  readFirstRunState,
  setFirstRunVisibility,
  type FirstRunCompletedState,
  type FirstRunLocalState,
  type FirstRunStepKey,
  writeFirstRunState,
} from './first-run-state';

const stepMeta: Array<{
  body: string;
  cta: string;
  href?: string;
  key: FirstRunStepKey;
  title: string;
}> = [
  {
    body: 'Turn a plain request into a ready-to-run brief.',
    cta: 'Post a task',
    href: '/dashboard/tasks/new',
    key: 'postedTask',
    title: 'Post a task',
  },
  {
    body: 'Choose an open task and send a useful response.',
    cta: 'Browse tasks',
    href: '/dashboard/tasks',
    key: 'respondedToTask',
    title: 'Respond to a task',
  },
];

function safeStorage() {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}

function completionChanged(a: FirstRunCompletedState, b: FirstRunCompletedState) {
  return a.postedTask !== b.postedTask || a.respondedToTask !== b.respondedToTask;
}

function completionFromInbox(data: unknown) {
  const inbox = data as { asRequester?: unknown[]; asWorker?: unknown[] } | null | undefined;
  return {
    postedTask: Boolean(inbox?.asRequester?.length),
    respondedToTask: Boolean(inbox?.asWorker?.length),
  };
}

export function FirstRunChecklist() {
  const { address, isConnected } = useAccount();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [localState, setLocalState] = useState<FirstRunLocalState>(() =>
    createDefaultFirstRunState()
  );
  const [loadedStorageScope, setLoadedStorageScope] = useState<string | null>(null);
  const storageScope = address?.toLowerCase() ?? 'anonymous';
  const hydrated = loadedStorageScope === storageScope;

  useEffect(() => {
    const stored = readFirstRunState(safeStorage(), address);
    setLocalState(stored);
    setLoadedStorageScope(storageScope);
  }, [address, storageScope]);

  const inboxQuery = trpc.agents.inbox.useQuery(
    { address: address ?? '' },
    {
      enabled: Boolean(isConnected && address),
      refetchOnWindowFocus: false,
    }
  );
  const publishedTask =
    pathname?.startsWith('/dashboard/tasks/') && searchParams?.get('published') === '1';
  const walletProgress = completionFromInbox(inboxQuery.data);

  const progress = useMemo(
    () =>
      deriveFirstRunProgress({
        localState,
        publishedTask,
        walletProgress,
      }),
    [localState, publishedTask, walletProgress.postedTask, walletProgress.respondedToTask]
  );

  useEffect(() => {
    if (!hydrated || !completionChanged(localState.completed, progress.completed)) {
      return;
    }
    setLocalState((current) => {
      const next = mergeFirstRunCompletion(current, progress.completed);
      writeFirstRunState(safeStorage(), next, address);
      return next;
    });
  }, [address, hydrated, localState.completed, progress.completed]);

  function updateState(next: FirstRunLocalState) {
    setLocalState(next);
    writeFirstRunState(safeStorage(), next, address);
  }

  const points = progress.points;
  const nextStep = stepMeta.find((step) => step.key === progress.nextStep);
  const allDone = points === FIRST_RUN_TOTAL_POINTS;

  if (!hydrated || localState.visibility === 'dismissed') {
    return null;
  }

  return (
    <section
      aria-label="First run onboarding"
      className="px-2 group-data-[collapsible=icon]:px-1"
      data-testid="first-run-checklist"
    >
      <div className="hidden justify-center py-1 group-data-[collapsible=icon]:flex">
        <div
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-md border border-sidebar-border/70 bg-sidebar-accent/42 font-mono text-[0.6rem] font-semibold text-sidebar-foreground/78"
        >
          {points}
        </div>
      </div>
      {localState.visibility === 'minimized' ? (
        <div className="group-data-[collapsible=icon]:hidden">
          <Button
            aria-label="Expand first-run checklist"
            className="h-auto w-full justify-between rounded-md px-3 py-2"
            onClick={() => updateState(setFirstRunVisibility(localState, 'open'))}
            title="Expand first-run checklist"
            type="button"
            variant="ghost"
          >
            <span className="text-xs">First run</span>
            <span className="flex items-center gap-2 font-mono text-[0.6rem] text-sidebar-foreground/62">
              {points}/{FIRST_RUN_TOTAL_POINTS}
              <IconChevronDown className="size-3" />
            </span>
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 rounded-lg border border-sidebar-border/62 bg-sidebar-accent/18 p-3 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.05)] group-data-[collapsible=icon]:hidden">
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="grid gap-0.5">
                <h2 className="font-mono text-[0.66rem] font-semibold tracking-[0.12em] text-sidebar-foreground/78 uppercase">
                  First run
                </h2>
                <p className="text-[0.68rem] leading-4 text-sidebar-foreground/52">
                  {allDone ? 'Complete' : `Next: ${nextStep?.title ?? 'Finish setup'}`}
                </p>
              </div>
              <div className="flex items-center gap-0.5">
                <Button
                  aria-label="Minimize first-run checklist"
                  className="text-sidebar-foreground/58 hover:text-sidebar-foreground"
                  onClick={() => updateState(setFirstRunVisibility(localState, 'minimized'))}
                  size="icon-xs"
                  title="Minimize first-run checklist"
                  type="button"
                  variant="ghost"
                >
                  <IconMinus />
                </Button>
                <Button
                  aria-label="Dismiss first-run checklist"
                  className="text-sidebar-foreground/58 hover:text-sidebar-foreground"
                  onClick={() => updateState(setFirstRunVisibility(localState, 'dismissed'))}
                  size="icon-xs"
                  title="Dismiss first-run checklist"
                  type="button"
                  variant="ghost"
                >
                  <IconX />
                </Button>
                <Badge
                  className="px-2 py-0.5 text-[0.56rem]"
                  variant={allDone ? 'success' : 'outline'}
                >
                  {points}/{FIRST_RUN_TOTAL_POINTS}
                </Badge>
              </div>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-sidebar-border/58">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${(points / FIRST_RUN_TOTAL_POINTS) * 100}%` }}
              />
            </div>
          </div>

          <ol className="grid gap-2">
            {stepMeta.map((step) => {
              const complete = progress.completed[step.key];
              const current = progress.nextStep === step.key;
              const stepPoints = FIRST_RUN_POINTS[step.key];
              return (
                <li
                  className={cn(
                    'grid gap-2 rounded-md border p-2',
                    complete
                      ? 'border-success/32 bg-success/8'
                      : current
                        ? 'border-primary/40 bg-primary/8'
                        : 'border-sidebar-border/46 bg-sidebar/24'
                  )}
                  key={step.key}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'flex size-5 shrink-0 items-center justify-center rounded-full border font-mono text-[0.58rem] font-semibold',
                        complete
                          ? 'border-success/40 bg-success/14 text-success'
                          : current
                            ? 'border-primary/38 bg-primary/12 text-primary'
                            : 'border-sidebar-border/70 bg-sidebar text-sidebar-foreground/54'
                      )}
                    >
                      {complete ? <IconCheck className="size-3" /> : stepPoints}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-sidebar-foreground/86">
                        {step.title}
                      </p>
                    </div>
                    <span className="font-mono text-[0.58rem] text-sidebar-foreground/44">
                      {stepPoints}
                    </span>
                  </div>

                  {current ? (
                    <p className="text-[0.68rem] leading-4 text-sidebar-foreground/54">
                      {step.body}
                    </p>
                  ) : null}

                  {step.href && current ? (
                    <Button asChild className="h-7 w-fit px-2 text-xs" size="xs" variant="outline">
                      <Link href={step.href as Route}>{step.cta}</Link>
                    </Button>
                  ) : null}

                  {!current && complete ? (
                    <p className="sr-only">
                      {step.title}
                      complete.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}

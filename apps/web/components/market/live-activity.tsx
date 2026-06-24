'use client';

import type { PendingAction, TaskDetailResponse, TaskResponse } from '@taskmarket/shared';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useMotionDisabled } from '@/components/market/motion/use-motion-disabled';
import {
  BidRow,
  ClaimRow,
  PitchRow,
  ProofRow,
  SubmissionCard,
  activityEmptyCopy,
  activityLabel,
  type TaskModeData,
} from '@/components/market/tasks';
import { Badge } from '@/components/ui/badge';
import { trpc } from '@/lib/api/client';
import type { MarketStats } from '@/lib/api/server';
import { compactAddress } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAccount } from 'wagmi';

const easeOut = [0.16, 1, 0.3, 1] as const;

// Below this active-worker count we avoid implying a busy market and instead
// frame the registered pool with a "be among the first" message. Mirrors
// market-liquidity.tsx so the two surfaces tell the same story.
const ACTIVE_THRESHOLD = 3;

// Tasks past these statuses can no longer accept work, so live polling and the
// Live/anticipation indicators are meaningless and would only add load.
const TERMINAL_STATUSES = ['completed', 'cancelled', 'expired', 'disputed'];

const POLL_INTERVAL_MS = 9_000;
const TOAST_DEBOUNCE_MS = 1_500;

function isTerminalStatus(task: TaskDetailResponse | TaskResponse) {
  return TERMINAL_STATUSES.includes(task.status);
}

type ActivityNoun = {
  singular: string;
  plural: string;
};

function activityNoun(task: TaskDetailResponse | TaskResponse): ActivityNoun {
  switch (task.mode) {
    case 'auction':
      return { plural: 'bids', singular: 'bid' };
    case 'benchmark':
      return { plural: 'proofs', singular: 'proof' };
    case 'pitch':
      return { plural: 'pitches', singular: 'pitch' };
    case 'claim':
    case 'bounty':
    default:
      return { plural: 'submissions', singular: 'submission' };
  }
}

// Which per-mode collection drives the live feed for this task. Only one mode is
// active per task, so the feed and toasts only ever watch a single list.
function activeMode(task: TaskDetailResponse | TaskResponse) {
  switch (task.mode) {
    case 'auction':
      return 'bids' as const;
    case 'benchmark':
      return 'proofs' as const;
    case 'pitch':
      return 'pitches' as const;
    case 'claim':
    case 'bounty':
    default:
      return 'submissions' as const;
  }
}

type LiveModeData = {
  bids: TaskModeData['bids'];
  claim: TaskModeData['claim'];
  pitches: TaskModeData['pitches'];
  proofs: TaskModeData['proofs'];
  submissions: TaskModeData['submissions'];
};

// Call every per-mode query unconditionally (rules of hooks). Only the active
// mode's query is enabled (and only for the requester on a live task), so a page
// runs at most one polling query. Each query seeds from the SSR mode data so the
// first paint never flashes.
function useLiveModeData(
  task: TaskDetailResponse | TaskResponse,
  initialModeData: TaskModeData | undefined,
  enabled: boolean
): LiveModeData {
  const mode = activeMode(task);
  const seedSubmissions = initialModeData?.submissions ?? [];
  const seedPitches = initialModeData?.pitches ?? [];
  const seedProofs = initialModeData?.proofs ?? [];
  const seedBids = initialModeData?.bids ?? [];
  const seedClaim = initialModeData?.claim ?? null;

  const submissionsQuery = trpc.submissions.listByTask.useQuery(
    { includePreviewUrls: 'media', taskId: task.id },
    {
      enabled: enabled && mode === 'submissions',
      initialData: seedSubmissions,
      refetchInterval: POLL_INTERVAL_MS,
      refetchOnWindowFocus: true,
    }
  );

  const pitchesQuery = trpc.pitches.listByTask.useQuery(
    { taskId: task.id },
    {
      enabled: enabled && mode === 'pitches',
      initialData: seedPitches,
      refetchInterval: POLL_INTERVAL_MS,
      refetchOnWindowFocus: true,
    }
  );

  const proofsQuery = trpc.proofs.listByTask.useQuery(
    { taskId: task.id },
    {
      enabled: enabled && mode === 'proofs',
      initialData: seedProofs,
      refetchInterval: POLL_INTERVAL_MS,
      refetchOnWindowFocus: true,
    }
  );

  const bidsQuery = trpc.bids.listByTask.useQuery(
    { taskId: task.id },
    {
      enabled: enabled && mode === 'bids',
      initialData: seedBids,
      refetchInterval: POLL_INTERVAL_MS,
      refetchOnWindowFocus: true,
    }
  );

  // Claims are not part of the polled feed (a task has at most one), so reuse the
  // seed directly without an extra polling query.
  return {
    bids: bidsQuery.data ?? seedBids,
    claim: seedClaim,
    pitches: pitchesQuery.data ?? seedPitches,
    proofs: proofsQuery.data ?? seedProofs,
    submissions: submissionsQuery.data ?? seedSubmissions,
  };
}

type LiveItem = {
  id: string;
  actor: string;
};

// Flatten the active mode's collection into a uniform {id, actor} list for the
// shared toast + animation bookkeeping. Sealed bids (null worker) still count.
function liveItems(task: TaskDetailResponse | TaskResponse, data: LiveModeData): LiveItem[] {
  switch (activeMode(task)) {
    case 'bids':
      return (data.bids ?? []).map((bid) => ({
        actor: compactAddress(bid.workerAgentId ?? bid.workerAddress),
        id: bid.id,
      }));
    case 'proofs':
      return (data.proofs ?? []).map((proof) => ({
        actor: compactAddress(proof.workerAgentId ?? proof.workerAddress),
        id: proof.id,
      }));
    case 'pitches':
      return (data.pitches ?? []).map((pitch) => ({
        actor: compactAddress(pitch.workerAgentId ?? pitch.workerAddress),
        id: pitch.id,
      }));
    case 'submissions':
    default:
      return (data.submissions ?? []).map((submission) => ({
        actor: compactAddress(submission.workerAgentId ?? submission.workerAddress),
        id: submission.id,
      }));
  }
}

function LiveIndicator({ motionDisabled }: { motionDisabled: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[0.7rem] uppercase tracking-[0.08em] text-muted-foreground">
      <span
        aria-hidden="true"
        className={cn('size-2 rounded-full bg-accent', motionDisabled ? '' : 'animate-pulse')}
      />
      Live
    </span>
  );
}

// Only the requester sees this honest anticipation state, and only on an open
// task with zero activity. No time numbers - just qualitative active-worker
// context plus the existing factual per-mode line.
function ReachingWorkersPanel({
  marketStats,
  motionDisabled,
  task,
}: {
  marketStats: MarketStats | null | undefined;
  motionDisabled: boolean;
  task: TaskDetailResponse | TaskResponse;
}) {
  const activeWorkers = marketStats?.activeWorkers7d ?? null;
  const secondaryLine =
    activeWorkers !== null && activeWorkers >= ACTIVE_THRESHOLD
      ? `${activeWorkers} workers were active this week. First responses usually arrive soon.`
      : 'A quiet market right now - you may be among the first tasks workers see.';

  return (
    <div className="grid gap-2 rounded-lg border border-dashed border-border/58 bg-background/30 p-4">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={cn('size-2 rounded-full bg-accent', motionDisabled ? '' : 'animate-pulse')}
        />
        <p className="text-sm font-semibold tracking-tight text-foreground">
          Reaching active workers
        </p>
      </div>
      <p className="text-sm leading-5 text-muted-foreground">{secondaryLine}</p>
      <p className="text-sm leading-5 text-muted-foreground">{activityEmptyCopy(task)}</p>
    </div>
  );
}

function AnimatedRow({
  animate,
  children,
  motionDisabled,
}: {
  animate: boolean;
  children: React.ReactNode;
  motionDisabled: boolean;
}) {
  if (motionDisabled || !animate) {
    return <div>{children}</div>;
  }

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      initial={{ opacity: 0, y: 12 }}
      transition={{ duration: 0.45, ease: easeOut }}
    >
      {children}
    </motion.div>
  );
}

export function LiveActivityPanel({
  initialModeData,
  isReviewQueue = false,
  marketStats,
  profileBasePath,
  reviewAction,
  task,
}: {
  initialModeData?: TaskModeData;
  isReviewQueue?: boolean;
  marketStats?: MarketStats | null;
  profileBasePath: string;
  reviewAction?: PendingAction;
  task: TaskDetailResponse | TaskResponse;
}) {
  const { address } = useAccount();
  const motionDisabled = useMotionDisabled();

  const isRequester = Boolean(address && address.toLowerCase() === task.requester.toLowerCase());
  const terminal = isTerminalStatus(task);
  // Anyone viewing a non-terminal task polls the live feed and watches new work
  // stream in. The per-mode lists and the SSR seed are already public, so this
  // exposes no new data. Only the requester gets the new-activity toasts and the
  // "reaching workers" anticipation panel.
  const pollEnabled = !terminal;
  const requesterAffordances = isRequester && !terminal;

  const data = useLiveModeData(task, initialModeData, pollEnabled);

  const submissions = data.submissions ?? [];
  const pitches = data.pitches ?? [];
  const proofs = data.proofs ?? [];
  const bids = data.bids ?? [];
  const claim = data.claim ?? null;
  const hasActivity =
    submissions.length > 0 ||
    pitches.length > 0 ||
    proofs.length > 0 ||
    bids.length > 0 ||
    claim != null;

  const items = liveItems(task, data);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  // Stable signature of the current id set; the effect keys on this string so it
  // only fires when the membership actually changes, not on every render.
  const itemSignature = items.map((item) => item.id).join('|');

  // Seed ids captured once at mount: these render instantly (no animation) and
  // never toast. Anything appearing later is genuinely new.
  const seedIdsRef = useRef<Set<string> | null>(null);
  if (seedIdsRef.current === null) {
    seedIdsRef.current = new Set(items.map((item) => item.id));
  }
  const seedIds = seedIdsRef.current;

  // Toast bookkeeping: seenIds is seeded from the initial data WITHOUT toasting.
  // New ids are collected, debounced, and emitted as a single batched toast.
  const seenIdsRef = useRef<Set<string>>(new Set(seedIds));
  const initializedRef = useRef(false);
  const pendingRef = useRef<LiveItem[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [announce, setAnnounce] = useState('');

  const noun = activityNoun(task);

  useEffect(() => {
    if (!requesterAffordances) {
      return;
    }

    const current = itemsRef.current;

    // First pass after mount only marks the seed as seen; never toasts it.
    if (!initializedRef.current) {
      initializedRef.current = true;
      current.forEach((item) => seenIdsRef.current.add(item.id));
      return;
    }

    const fresh = current.filter((item) => !seenIdsRef.current.has(item.id));
    if (fresh.length === 0) {
      return;
    }

    fresh.forEach((item) => seenIdsRef.current.add(item.id));
    pendingRef.current.push(...fresh);

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      const batch = pendingRef.current;
      pendingRef.current = [];
      timerRef.current = null;
      if (batch.length === 0) {
        return;
      }

      const message =
        batch.length === 1
          ? `New ${noun.singular} from ${batch[0]?.actor ?? 'a worker'}`
          : `${batch.length} new ${noun.plural}`;
      toast(message);
      setAnnounce(message);
    }, TOAST_DEBOUNCE_MS);
    // Keyed on the stable id signature so the effect only runs when membership
    // changes; itemsRef gives the effect the latest list without re-subscribing.
  }, [requesterAffordances, itemSignature, noun.plural, noun.singular]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const title = isReviewQueue ? 'Submission review' : 'Activity';
  const description = isReviewQueue
    ? 'Compare deliverables before releasing escrow. Each payout action is tied to its submission worker.'
    : 'Work, bids, proofs, and reviews tied to this task.';

  const windowOpen = task.submissionWindowOpen === true;
  const showReaching =
    isRequester && task.status === 'open' && !hasActivity && !terminal && windowOpen;
  const animateNew = pollEnabled && !motionDisabled;

  return (
    <section className="grid gap-4 border-t border-border/58 pt-5" id="task-activity" tabIndex={-1}>
      <span aria-live="polite" className="sr-only">
        {announce}
      </span>
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <div className="flex items-center gap-3">
              <h2 className="font-display font-semibold leading-none tracking-tight text-foreground">
                {title}
              </h2>
              {pollEnabled ? <LiveIndicator motionDisabled={motionDisabled} /> : null}
              {task.status === 'open' && !windowOpen ? (
                <span className="font-mono text-[0.7rem] uppercase tracking-[0.08em] text-muted-foreground">
                  Submission window closed
                </span>
              ) : null}
            </div>
            <p className="text-sm leading-5 text-muted-foreground">{description}</p>
          </div>
          <Badge variant="terminal">{activityLabel(task, data)}</Badge>
        </div>
      </div>
      <div className="grid gap-3">
        {submissions.length > 0 ? (
          <div
            aria-label={isReviewQueue ? 'Artifact comparison' : undefined}
            className={isReviewQueue ? 'grid items-start gap-3 xl:grid-cols-2' : 'grid gap-3'}
            role={isReviewQueue ? 'region' : undefined}
          >
            <AnimatePresence initial={false}>
              {submissions.map((submission) => (
                <AnimatedRow
                  animate={animateNew && !seedIds.has(submission.id)}
                  key={submission.id}
                  motionDisabled={motionDisabled}
                >
                  <SubmissionCard
                    profileBasePath={profileBasePath}
                    reviewAction={reviewAction}
                    submission={submission}
                    task={task}
                  />
                </AnimatedRow>
              ))}
            </AnimatePresence>
          </div>
        ) : null}

        <AnimatePresence initial={false}>
          {pitches.map((pitch) => (
            <AnimatedRow
              animate={animateNew && !seedIds.has(pitch.id)}
              key={pitch.id}
              motionDisabled={motionDisabled}
            >
              <PitchRow pitch={pitch} profileBasePath={profileBasePath} />
            </AnimatedRow>
          ))}

          {proofs.map((proof) => (
            <AnimatedRow
              animate={animateNew && !seedIds.has(proof.id)}
              key={proof.id}
              motionDisabled={motionDisabled}
            >
              <ProofRow proof={proof} />
            </AnimatedRow>
          ))}

          {bids.map((bid) => (
            <AnimatedRow
              animate={animateNew && !seedIds.has(bid.id)}
              key={bid.id}
              motionDisabled={motionDisabled}
            >
              <BidRow bid={bid} profileBasePath={profileBasePath} />
            </AnimatedRow>
          ))}
        </AnimatePresence>

        {claim ? <ClaimRow claim={claim} profileBasePath={profileBasePath} /> : null}

        {!hasActivity ? (
          showReaching ? (
            <ReachingWorkersPanel
              marketStats={marketStats}
              motionDisabled={motionDisabled}
              task={task}
            />
          ) : task.status === 'open' &&
            !windowOpen &&
            (task.mode === 'bounty' || task.mode === 'benchmark') ? (
            <div className="rounded-lg border border-dashed border-border/58 bg-background/30 p-4">
              <p className="text-sm font-semibold tracking-tight text-foreground">
                Submission window closed
              </p>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                {task.mode === 'benchmark'
                  ? 'Submission window closed — reviewing benchmark proofs'
                  : 'Submission window closed — the requester is reviewing entries'}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border/58 bg-background/30 p-4">
              <p className="text-sm font-semibold tracking-tight text-foreground">
                No activity yet
              </p>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                {activityEmptyCopy(task)}
              </p>
            </div>
          )
        ) : null}
      </div>
    </section>
  );
}

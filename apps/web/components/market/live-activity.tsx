'use client';

import type { PendingAction, TaskDetailResponse, TaskResponse } from '@taskmarket/shared';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeftIcon, ChevronRightIcon, Images, LayoutGridIcon, ListIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useMotionDisabled } from '@/components/market/motion/use-motion-disabled';
import {
  SubmissionGalleryDialog,
  submissionMediaEntries,
} from '@/components/market/submission-gallery';
import { WorkerSubmissionActions } from '@/components/market/worker-submission-actions';
import { WorkerSubmissionHistory } from '@/components/market/worker-submission-history';
import { RelativeTime } from '@/components/market/motion/relative-time';
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
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { READ_AUTH_CONTEXT_KEY, trpc } from '@/lib/api/client';
import type { MarketStats } from '@/lib/api/server';
import { actorDisplayName } from '@/lib/format';
import {
  groupSubmissionsByWorker,
  sortSubmissionGroups,
  type WorkerSubmissionGroup,
} from '@/lib/market/submission-review';
import { useReadAuthSignature } from '@/lib/use-read-auth-signature';
import { cn } from '@/lib/utils';
import { useAccount } from 'wagmi';

const easeOut = [0.16, 1, 0.3, 1] as const;

// Below this active-worker count we avoid implying a busy market and instead
// frame the registered pool with a "be among the first" message. Mirrors
// market-liquidity.tsx so the two surfaces tell the same story.
export const ACTIVE_THRESHOLD = 3;

// Tasks past these statuses can no longer accept work, so live polling and the
// Live/anticipation indicators are meaningless and would only add load.
const TERMINAL_STATUSES = ['completed', 'cancelled', 'expired', 'disputed'];

const POLL_INTERVAL_MS = 9_000;
const TOAST_DEBOUNCE_MS = 1_500;

// A task can accumulate hundreds of submissions; rendering them all in one scroll pushes
// the requirements/next-actions panels far down the page and makes manual review
// impractical. Client-side pagination keeps each page small without adding a fetch.
const PAGE_SIZE = 10;

type ReviewSort = 'newest' | 'oldest' | 'credibility';
type ReviewView = 'gallery' | 'list';

const REVIEW_SORT_OPTIONS: Array<{ value: ReviewSort; label: string }> = [
  { value: 'newest', label: 'Newest submitters' },
  { value: 'oldest', label: 'Oldest submitters' },
  { value: 'credibility', label: 'Most experienced worker' },
];

// Shared by submissions and pitches -- the only two review-queue item types that carry
// both a submission timestamp and workerStats.completedTasks (proofs and bids have
// neither the same credibility signal, so they keep arrival order only).
function sortByReview<
  T extends { submittedAt: string; workerStats?: { completedTasks: number } | null },
>(list: readonly T[], sort: ReviewSort): T[] {
  const sorted = [...list];
  if (sort === 'credibility') {
    sorted.sort(
      (a, b) => (b.workerStats?.completedTasks ?? -1) - (a.workerStats?.completedTasks ?? -1)
    );
    return sorted;
  }

  sorted.sort((a, b) => {
    const diff = new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime();
    return sort === 'oldest' ? diff : -diff;
  });
  return sorted;
}

export function isTerminalStatus(task: TaskDetailResponse | TaskResponse) {
  return TERMINAL_STATUSES.includes(task.status);
}

// The API's submissionWindowOpen reports the deliverable window, which for
// claim/pitch/auction only opens after a worker is locked in. "Is this open
// task still taking entries" (claims, pitches, bids, submissions) instead
// depends on the mode's intake deadline.
export function isOpenForWork(task: TaskDetailResponse | TaskResponse, now = new Date()): boolean {
  if (task.status !== 'open') return false;
  if (new Date(task.expiryTime) <= now) return false;
  switch (task.mode) {
    case 'pitch':
      return new Date(task.pitchDeadline ?? task.expiryTime) > now;
    case 'auction':
      return new Date(task.bidDeadline ?? task.expiryTime) > now;
    default:
      return true;
  }
}

type ActivityNoun = {
  singular: string;
  plural: string;
};

export function activityNoun(task: TaskDetailResponse | TaskResponse): ActivityNoun {
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
// mode's query is enabled, so a page runs at most one polling query. Each query
// seeds from the SSR mode data so the first paint never flashes.
export function useLiveModeData(
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

type TaskActivitySummary = {
  count: number;
  hasActivity: boolean;
  latestActor: string | null;
};

// A thin read-only summary over the same live mode data the panel polls. It reuses
// the same OR-chain the panel uses to decide "has activity" so both surfaces stay
// in lockstep. count is the flattened item length; claim-only tasks report
// hasActivity via the OR-chain even though liveItems does not include the claim.
export function useTaskActivitySummary(
  task: TaskDetailResponse | TaskResponse,
  initialModeData: TaskModeData | undefined,
  enabled: boolean
): TaskActivitySummary {
  const data = useLiveModeData(task, initialModeData, enabled);
  const items = liveItems(task, data);
  const hasActivity =
    (data.submissions?.length ?? 0) > 0 ||
    (data.pitches?.length ?? 0) > 0 ||
    (data.proofs?.length ?? 0) > 0 ||
    (data.bids?.length ?? 0) > 0 ||
    data.claim != null;
  const count = items.length;
  const latestActor = items[items.length - 1]?.actor ?? null;

  return { count, hasActivity, latestActor };
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
        actor: actorDisplayName({ address: bid.workerAddress, agentId: bid.workerAgentId }),
        id: bid.id,
      }));
    case 'proofs':
      return (data.proofs ?? []).map((proof) => ({
        actor: actorDisplayName({ address: proof.workerAddress, agentId: proof.workerAgentId }),
        id: proof.id,
      }));
    case 'pitches':
      return (data.pitches ?? []).map((pitch) => ({
        actor: actorDisplayName({ address: pitch.workerAddress, agentId: pitch.workerAgentId }),
        id: pitch.id,
      }));
    case 'submissions':
    default:
      return (data.submissions ?? []).map((submission) => ({
        actor: actorDisplayName({
          address: submission.workerAddress,
          agentId: submission.workerAgentId,
        }),
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

// Independent live feed of a task's `submissions` channel, used by the benchmark
// secondary review surface below. This deliberately duplicates (rather than shares)
// the primary panel's scoped-submissions effect: the primary feed only polls
// `submissions` when `activeMode(task) === 'submissions'` (bounty/claim), which is
// never true for benchmark, so benchmark's secondary channel needs its own poll --
// and keeping it self-contained guarantees it cannot entangle with the primary
// feed's own bookkeeping (a hard requirement of Milestone 5).
function useSecondarySubmissionsFeed(
  task: TaskDetailResponse | TaskResponse,
  initialSubmissions: TaskModeData['submissions'],
  enabled: boolean
) {
  const { address } = useAccount();
  const readAuthReady = useReadAuthSignature(
    task.submissionVisibility === 'public' ? undefined : address
  );
  const utils = trpc.useUtils();
  const authenticatedAddress = readAuthReady ? address?.toLowerCase() : undefined;
  const usesScopedSubmissions = task.submissionVisibility !== 'public';
  const terminal = isTerminalStatus(task);
  const seed = initialSubmissions ?? [];

  const publicQuery = trpc.submissions.listByTask.useQuery(
    { includePreviewUrls: 'media', taskId: task.id },
    {
      enabled: enabled && !terminal && !usesScopedSubmissions,
      initialData: seed,
      refetchInterval: POLL_INTERVAL_MS,
      refetchOnWindowFocus: true,
    }
  );

  const [scopedSubmissions, setScopedSubmissions] = useState<{
    address: string;
    data: TaskModeData['submissions'];
    taskId: string;
  } | null>(null);
  const [scopedRefreshVersion, setScopedRefreshVersion] = useState(0);

  useEffect(() => {
    if (!enabled || !usesScopedSubmissions || !authenticatedAddress) return;

    const input = { includePreviewUrls: 'media' as const, taskId: task.id };
    const controller = new AbortController();
    const scopedAddress = authenticatedAddress;
    let disposed = false;
    let fetching = false;

    async function load() {
      if (fetching) return;
      fetching = true;
      try {
        const submissions = await utils.client.submissions.listByTask.query(input, {
          context: { [READ_AUTH_CONTEXT_KEY]: true },
          signal: controller.signal,
        });
        if (!disposed) {
          setScopedSubmissions({ address: scopedAddress, data: submissions, taskId: task.id });
        }
      } catch {
        // A route change or aborted request falls back to the anonymous seed.
      } finally {
        fetching = false;
      }
    }

    void load();
    const interval = terminal ? undefined : window.setInterval(() => void load(), POLL_INTERVAL_MS);

    return () => {
      disposed = true;
      controller.abort();
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [
    authenticatedAddress,
    enabled,
    scopedRefreshVersion,
    terminal,
    task.id,
    usesScopedSubmissions,
    utils.client,
  ]);

  const visibleSubmissions = usesScopedSubmissions
    ? scopedSubmissions &&
      scopedSubmissions.address === authenticatedAddress &&
      scopedSubmissions.taskId === task.id
      ? scopedSubmissions.data
      : seed
    : (publicQuery.data ?? seed);

  return {
    refreshScoped: () => setScopedRefreshVersion((current) => current + 1),
    visibleSubmissions,
  };
}

// Benchmark's optional, additional-artifact-delivery channel (`task submit`,
// alongside its primary `task proof` flow). The backend already generates real
// `accept`/`reject_submission` pending actions for it (`contestHasSubmissions`),
// identical to bounty's, but until this surface existed there was nowhere in the
// UI to see or act on it. This reuses the exact grouping/action/history contract
// SR-1 through SR-4 already built for bounty, fed from `modeData.submissions`
// instead of `modeData.proofs`, and owns entirely independent state so it can
// never interfere with the primary proof feed above it.
function BenchmarkSubmissionsSection({
  initialSubmissions,
  profileBasePath,
  reviewActions,
  task,
}: {
  initialSubmissions: TaskModeData['submissions'];
  profileBasePath: string;
  reviewActions?: {
    acceptAction?: PendingAction;
    rejectAction?: PendingAction;
  };
  task: TaskDetailResponse | TaskResponse;
}) {
  const { address } = useAccount();
  const isRequester = Boolean(address && address.toLowerCase() === task.requester.toLowerCase());
  const terminal = isTerminalStatus(task);
  const { refreshScoped, visibleSubmissions } = useSecondarySubmissionsFeed(
    task,
    initialSubmissions,
    !terminal
  );

  const [open, setOpen] = useState(false);
  const [reviewSort, setReviewSort] = useState<ReviewSort>('newest');
  const [reviewView, setReviewView] = useState<ReviewView>('gallery');
  const [page, setPage] = useState(1);
  const [rejectedPage, setRejectedPage] = useState(1);
  const [rejectedOpen, setRejectedOpen] = useState(false);
  const [selectedWorkerKey, setSelectedWorkerKey] = useState<string | null>(null);
  const [optimisticRejectedKeys, setOptimisticRejectedKeys] = useState<Set<string>>(new Set());
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryArtifactId, setGalleryArtifactId] = useState<string | null>(null);
  const historyOriginRef = useRef<{
    page: number;
    rejectedPage: number;
    source: 'active' | 'rejected';
    workerKey: string;
  } | null>(null);

  const visibilityScopeKey = `${task.id}:${task.submissionVisibility}:${address?.toLowerCase() ?? 'anonymous'}:secondary-submissions`;

  useEffect(() => {
    setOptimisticRejectedKeys(new Set());
    setPage(1);
    setRejectedPage(1);
    setRejectedOpen(false);
    setSelectedWorkerKey(null);
    setGalleryOpen(false);
    setGalleryArtifactId(null);
  }, [visibilityScopeKey]);

  const groupedReview = useMemo(() => {
    const grouped = groupSubmissionsByWorker(visibleSubmissions ?? []);
    const activeGroups: WorkerSubmissionGroup[] = [];
    const rejectedGroups = [...grouped.rejectedGroups];

    for (const group of grouped.activeGroups) {
      if (optimisticRejectedKeys.has(group.workerKey)) {
        rejectedGroups.push({ ...group, rejected: true });
      } else {
        activeGroups.push(group);
      }
    }

    return {
      ...grouped,
      activeGroups: sortSubmissionGroups(activeGroups, reviewSort),
      rejectedGroups: sortSubmissionGroups(rejectedGroups, 'newest'),
    };
  }, [optimisticRejectedKeys, reviewSort, visibleSubmissions]);

  const activeGroups = groupedReview.activeGroups;
  const rejectedGroups = groupedReview.rejectedGroups;
  const selectedGroup =
    [...activeGroups, ...rejectedGroups].find((group) => group.workerKey === selectedWorkerKey) ??
    null;

  useEffect(() => {
    if (optimisticRejectedKeys.size === 0) return;
    const confirmedKeys = new Set(
      groupSubmissionsByWorker(visibleSubmissions ?? []).rejectedGroups.map(
        (group) => group.workerKey
      )
    );
    setOptimisticRejectedKeys((current) => {
      const pending = new Set([...current].filter((workerKey) => !confirmedKeys.has(workerKey)));
      return pending.size === current.size ? current : pending;
    });
  }, [optimisticRejectedKeys.size, visibleSubmissions]);

  useEffect(() => {
    if (!selectedWorkerKey || selectedGroup) return;
    setSelectedWorkerKey(null);
  }, [selectedGroup, selectedWorkerKey]);

  const totalPages = Math.max(1, Math.ceil(activeGroups.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageEnd = pageStart + PAGE_SIZE;
  const pagedActiveGroups = activeGroups.slice(pageStart, pageEnd);
  const rejectedTotalPages = Math.max(1, Math.ceil(rejectedGroups.length / PAGE_SIZE));
  const galleryEntries = submissionMediaEntries(
    activeGroups.map((g) => g.representativeSubmission)
  );

  const openHistory = (group: WorkerSubmissionGroup, source: 'active' | 'rejected') => {
    historyOriginRef.current = {
      page: currentPage,
      rejectedPage,
      source,
      workerKey: group.workerKey,
    };
    setSelectedWorkerKey(group.workerKey);
  };

  const restoreHistoryOrigin = () => {
    const origin = historyOriginRef.current;
    setSelectedWorkerKey(null);
    if (!origin) return;

    const currentRejectedIndex = rejectedGroups.findIndex(
      (group) => group.workerKey === origin.workerKey
    );
    const currentActiveIndex = activeGroups.findIndex(
      (group) => group.workerKey === origin.workerKey
    );

    if (currentRejectedIndex >= 0) {
      setRejectedOpen(true);
      setRejectedPage(Math.floor(currentRejectedIndex / PAGE_SIZE) + 1);
    } else {
      setPage(
        currentActiveIndex >= 0 ? Math.floor(currentActiveIndex / PAGE_SIZE) + 1 : origin.page
      );
      if (origin.source === 'rejected') {
        setRejectedOpen(true);
        setRejectedPage(origin.rejectedPage);
      }
    }
  };

  const handleRejectSuccess = (workerKey: string) => {
    setOptimisticRejectedKeys((current) => new Set(current).add(workerKey));
    refreshScoped();
  };

  const openGalleryAt = (artifactId: string) => {
    setGalleryArtifactId(artifactId);
    setGalleryOpen(true);
  };

  const disclosureLabel = `Additional submissions (${groupedReview.totalSubmissionCount})`;

  if (selectedGroup) {
    return (
      <section
        className="grid gap-4 border-t border-border/58 pt-5"
        data-testid="benchmark-submission-review"
      >
        <div className="grid gap-1">
          <h3 className="font-display font-semibold leading-none tracking-tight text-foreground">
            Additional submissions
          </h3>
          <p className="text-sm leading-5 text-muted-foreground">
            Optional artifact deliveries submitted alongside benchmark proofs.
          </p>
        </div>
        <WorkerSubmissionHistory
          actionArea={
            isRequester ? (
              <WorkerSubmissionActions
                acceptAction={reviewActions?.acceptAction}
                group={selectedGroup}
                onRejectSuccess={handleRejectSuccess}
                rejectAction={reviewActions?.rejectAction}
                task={task}
              />
            ) : undefined
          }
          group={selectedGroup}
          initialView={reviewView}
          onBack={restoreHistoryOrigin}
          profileBasePath={profileBasePath}
          task={task}
          visibilityScopeKey={visibilityScopeKey}
        />
      </section>
    );
  }

  return (
    <details
      className="border-t border-border/58 pt-5"
      data-testid="benchmark-submission-review"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      open={open}
    >
      <summary className="cursor-pointer select-none font-display font-semibold text-foreground">
        <span aria-live="polite" data-testid="benchmark-submission-review-summary">
          {disclosureLabel}
        </span>
      </summary>
      <div className="mt-4 grid gap-4">
        {activeGroups.length > 0 ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div
                aria-label="Additional submission view"
                className="flex items-center gap-2"
                role="group"
              >
                <Button
                  aria-label="Gallery view"
                  aria-pressed={reviewView === 'gallery'}
                  data-active={reviewView === 'gallery'}
                  onClick={() => setReviewView('gallery')}
                  size="chip"
                  type="button"
                  variant="chip"
                >
                  <LayoutGridIcon className="size-3.5" />
                  Gallery
                </Button>
                <Button
                  aria-label="List view"
                  aria-pressed={reviewView === 'list'}
                  data-active={reviewView === 'list'}
                  onClick={() => setReviewView('list')}
                  size="chip"
                  type="button"
                  variant="chip"
                >
                  <ListIcon className="size-3.5" />
                  List
                </Button>
              </div>
              {activeGroups.length > 1 ? (
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  Sort:
                  <NativeSelect
                    aria-label="Sort additional submissions"
                    onChange={(event) => {
                      setReviewSort(event.target.value as ReviewSort);
                      setPage(1);
                    }}
                    value={reviewSort}
                    wrapperClassName="w-auto"
                  >
                    {REVIEW_SORT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              ) : null}
            </div>

            <div
              aria-label="Additional artifact comparison"
              className={cn(
                'grid',
                reviewView === 'gallery'
                  ? 'items-stretch gap-5 md:grid-cols-2'
                  : 'items-start gap-3'
              )}
              role="region"
            >
              {pagedActiveGroups.map((group) => (
                <div
                  aria-label={`Submitter ${actorDisplayName({
                    address: group.workerAddress,
                    agentId: group.representativeSubmission.workerAgentId,
                  })}, ${group.submissions.length} ${
                    group.submissions.length === 1 ? 'submission' : 'submissions'
                  }`}
                  className="grid min-w-0 gap-3"
                  data-testid={`benchmark-submitter-group-${group.workerKey}`}
                  key={group.workerKey}
                  role="group"
                >
                  <SubmissionCard
                    layout={reviewView}
                    onOpenMedia={openGalleryAt}
                    profileBasePath={profileBasePath}
                    submission={group.representativeSubmission}
                    task={task}
                  />
                  {group.submissions.length > 1 ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="font-mono text-xs text-muted-foreground">
                        {group.submissions.length} submissions
                      </p>
                      <Button
                        aria-label={`View all ${group.submissions.length} submissions from ${actorDisplayName(
                          {
                            address: group.workerAddress,
                            agentId: group.representativeSubmission.workerAgentId,
                          }
                        )}`}
                        data-testid={`benchmark-submitter-history-origin-${group.workerKey}`}
                        onClick={() => openHistory(group, 'active')}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        View {group.submissions.length} submissions
                      </Button>
                    </div>
                  ) : null}
                  {isRequester ? (
                    <WorkerSubmissionActions
                      acceptAction={reviewActions?.acceptAction}
                      group={group}
                      onRejectSuccess={handleRejectSuccess}
                      rejectAction={reviewActions?.rejectAction}
                      task={task}
                    />
                  ) : null}
                </div>
              ))}
            </div>

            {activeGroups.length > PAGE_SIZE ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/58 pt-3">
                <p className="font-mono text-xs text-muted-foreground">
                  Showing {pageStart + 1}-{Math.min(pageEnd, activeGroups.length)} of{' '}
                  {activeGroups.length} submitters
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    disabled={currentPage <= 1}
                    onClick={() => setPage(currentPage - 1)}
                    size="icon-xs"
                    type="button"
                    variant="outline"
                  >
                    <ChevronLeftIcon aria-hidden />
                    <span className="sr-only">Previous page</span>
                  </Button>
                  <span className="font-mono text-xs text-muted-foreground">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    disabled={currentPage >= totalPages}
                    onClick={() => setPage(currentPage + 1)}
                    size="icon-xs"
                    type="button"
                    variant="outline"
                  >
                    <ChevronRightIcon aria-hidden />
                    <span className="sr-only">Next page</span>
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No active additional submissions to review.
          </p>
        )}

        {rejectedGroups.length > 0 ? (
          <details
            className="border-t border-border/58 pt-4"
            data-testid="benchmark-rejected-submitters"
            onToggle={(event) => setRejectedOpen(event.currentTarget.open)}
            open={rejectedOpen}
          >
            <summary className="cursor-pointer select-none font-display font-semibold text-foreground">
              Rejected submitters ({rejectedGroups.length})
            </summary>
            <div className="mt-4 grid gap-3">
              {rejectedGroups
                .slice((rejectedPage - 1) * PAGE_SIZE, rejectedPage * PAGE_SIZE)
                .map((group) => (
                  <div
                    className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-border/52 bg-background/30 p-3"
                    key={group.workerKey}
                  >
                    <div className="grid min-w-0 gap-1">
                      <p className="truncate font-mono text-sm font-semibold text-foreground">
                        {actorDisplayName({
                          address: group.workerAddress,
                          agentId: group.representativeSubmission.workerAgentId,
                        })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {group.submissions.length}{' '}
                        {group.submissions.length === 1 ? 'submission' : 'submissions'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        First <RelativeTime value={group.firstSubmittedAt} />
                        {' · '}Latest <RelativeTime value={group.latestSubmittedAt} />
                      </p>
                    </div>
                    <Button
                      data-testid={`benchmark-submitter-history-origin-${group.workerKey}`}
                      onClick={() => openHistory(group, 'rejected')}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      View history
                    </Button>
                  </div>
                ))}
              {rejectedGroups.length > PAGE_SIZE ? (
                <div className="flex items-center justify-between gap-3">
                  <Button
                    disabled={rejectedPage <= 1}
                    onClick={() => setRejectedPage((current) => current - 1)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Previous rejected
                  </Button>
                  <span className="font-mono text-xs text-muted-foreground">
                    Page {rejectedPage} of {rejectedTotalPages}
                  </span>
                  <Button
                    disabled={rejectedPage >= rejectedTotalPages}
                    onClick={() => setRejectedPage((current) => current + 1)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Next rejected
                  </Button>
                </div>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>
      <SubmissionGalleryDialog
        entries={galleryEntries}
        entryPolicy="snapshot-membership"
        initialArtifactId={galleryArtifactId}
        onOpenChange={setGalleryOpen}
        open={galleryOpen}
        profileBasePath={profileBasePath}
        sessionKey={`${visibilityScopeKey}:additional-submitters`}
        taskId={task.id}
      />
    </details>
  );
}

export function LiveActivityPanel({
  initialModeData,
  marketStats,
  profileBasePath,
  reviewActions,
  secondarySubmissionReview = false,
  submissionReviewEligible = false,
  task,
}: {
  initialModeData?: TaskModeData;
  marketStats?: MarketStats | null;
  profileBasePath: string;
  reviewActions?: {
    acceptAction?: PendingAction;
    rejectAction?: PendingAction;
  };
  secondarySubmissionReview?: boolean;
  submissionReviewEligible?: boolean;
  task: TaskDetailResponse | TaskResponse;
}) {
  const { address } = useAccount();
  const readAuthReady = useReadAuthSignature(
    task.submissionVisibility === 'public' ? undefined : address
  );
  const motionDisabled = useMotionDisabled();
  const utils = trpc.useUtils();

  const isRequester = Boolean(address && address.toLowerCase() === task.requester.toLowerCase());
  const terminal = isTerminalStatus(task);
  const authenticatedAddress = readAuthReady ? address?.toLowerCase() : undefined;
  const usesScopedSubmissions =
    activeMode(task) === 'submissions' && task.submissionVisibility !== 'public';
  // Anyone viewing a non-terminal task polls the live feed and watches new work
  // stream in. The per-mode lists and the SSR seed are already public, so this
  // exposes no new data. Only the requester gets the new-activity toasts and the
  // "reaching workers" anticipation panel.
  const pollEnabled = !terminal;
  const requesterAffordances = isRequester && !terminal;

  // Authenticated submissions use a local request below, never the shared query
  // cache. Other modes, and public submissions, keep their normal live query.
  const data = useLiveModeData(task, initialModeData, pollEnabled && !usesScopedSubmissions);
  const [scopedSubmissions, setScopedSubmissions] = useState<{
    address: string;
    data: TaskModeData['submissions'];
    taskId: string;
  } | null>(null);
  const [scopedRefreshVersion, setScopedRefreshVersion] = useState(0);
  const scopedSeedKeyRef = useRef<string | null>(null);
  const scopedSeedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!authenticatedAddress || !usesScopedSubmissions) return;

    const input = {
      includePreviewUrls: 'media' as const,
      taskId: task.id,
    };
    const controller = new AbortController();
    const scopedAddress = authenticatedAddress;
    const scopedKey = `${task.id}:${scopedAddress}`;
    let disposed = false;
    let fetching = false;

    async function load() {
      if (fetching) return;
      fetching = true;
      try {
        const submissions = await utils.client.submissions.listByTask.query(input, {
          context: { [READ_AUTH_CONTEXT_KEY]: true },
          signal: controller.signal,
        });
        if (!disposed) {
          // The first authenticated response establishes the requester's
          // private baseline. Only later polls should announce new arrivals.
          if (scopedSeedKeyRef.current !== scopedKey) {
            scopedSeedKeyRef.current = scopedKey;
            scopedSeedIdsRef.current = new Set(
              (submissions ?? []).map((submission) =>
                submissionReviewEligible ? submission.workerAddress.toLowerCase() : submission.id
              )
            );
          }
          setScopedSubmissions({
            address: scopedAddress,
            data: submissions,
            taskId: task.id,
          });
        }
      } catch {
        // A route change or aborted request falls back to the anonymous seed.
      } finally {
        fetching = false;
      }
    }

    void load();
    const interval = terminal ? undefined : window.setInterval(() => void load(), POLL_INTERVAL_MS);

    return () => {
      disposed = true;
      controller.abort();
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [
    authenticatedAddress,
    scopedRefreshVersion,
    submissionReviewEligible,
    terminal,
    task.id,
    usesScopedSubmissions,
    utils.client,
  ]);

  const [reviewSort, setReviewSort] = useState<ReviewSort>('newest');
  const [reviewView, setReviewView] = useState<ReviewView>('gallery');
  const [page, setPage] = useState(1);
  const [rejectedPage, setRejectedPage] = useState(1);
  const [rejectedOpen, setRejectedOpen] = useState(false);
  const [selectedWorkerKey, setSelectedWorkerKey] = useState<string | null>(null);
  const [optimisticRejectedKeys, setOptimisticRejectedKeys] = useState<Set<string>>(new Set());
  const historyOriginRef = useRef<{
    activePage: number;
    rejectedPage: number;
    source: 'active' | 'rejected';
    scrollY: number;
    workerKey: string;
  } | null>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);

  const authenticatedSubmissions =
    scopedSubmissions &&
    scopedSubmissions.address === authenticatedAddress &&
    scopedSubmissions.taskId === task.id
      ? scopedSubmissions.data
      : undefined;
  const visibleSubmissions =
    task.submissionVisibility === 'public'
      ? (data.submissions ?? [])
      : (authenticatedSubmissions ?? initialModeData?.submissions ?? []);
  const visibilityScopeKey = `${task.id}:${task.submissionVisibility}:${authenticatedAddress ?? 'anonymous'}`;
  const submissions = sortByReview(visibleSubmissions, reviewSort);
  const groupedReview = useMemo(() => {
    const grouped = groupSubmissionsByWorker(visibleSubmissions);
    const activeGroups: WorkerSubmissionGroup[] = [];
    const rejectedGroups = [...grouped.rejectedGroups];

    for (const group of grouped.activeGroups) {
      if (optimisticRejectedKeys.has(group.workerKey)) {
        rejectedGroups.push({ ...group, rejected: true });
      } else {
        activeGroups.push(group);
      }
    }

    return {
      ...grouped,
      activeGroups: sortSubmissionGroups(activeGroups, reviewSort),
      rejectedGroups: sortSubmissionGroups(rejectedGroups, 'newest'),
    };
  }, [optimisticRejectedKeys, reviewSort, visibleSubmissions]);
  const activeGroups = groupedReview.activeGroups;
  const rejectedGroups = groupedReview.rejectedGroups;
  const selectedGroup =
    [...activeGroups, ...rejectedGroups].find((group) => group.workerKey === selectedWorkerKey) ??
    null;
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

  // Every mode is mutually exclusive per task, so at most one of these lists is ever
  // non-empty -- this total is just whichever one is active.
  const totalItems = submissionReviewEligible
    ? activeGroups.length
    : submissions.length + pitches.length + proofs.length + bids.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageEnd = pageStart + PAGE_SIZE;
  const pagedSubmissions = submissions.slice(pageStart, pageEnd);
  const pagedActiveGroups = activeGroups.slice(pageStart, pageEnd);
  const pagedPitches = pitches.slice(pageStart, pageEnd);
  const pagedProofs = proofs.slice(pageStart, pageEnd);
  const pagedBids = bids.slice(pageStart, pageEnd);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  // Gallery over every media artifact across ALL submissions (not just the current
  // page), in feed order. Opened from the header button (first entry) or from a
  // card's hero/thumbnail (that artifact).
  const galleryEntries = submissionMediaEntries(
    submissionReviewEligible
      ? activeGroups.map((group) => group.representativeSubmission)
      : submissions
  );
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryArtifactId, setGalleryArtifactId] = useState<string | null>(null);
  const openGalleryAt = (artifactId: string) => {
    setGalleryArtifactId(artifactId);
    setGalleryOpen(true);
  };

  const activityData = usesScopedSubmissions ? { ...data, submissions: visibleSubmissions } : data;
  const items = submissionReviewEligible
    ? [...groupedReview.activeGroups, ...groupedReview.rejectedGroups].map((group) => ({
        actor: actorDisplayName({
          address: group.workerAddress,
          agentId: group.representativeSubmission.workerAgentId,
        }),
        id: group.workerKey,
      }))
    : liveItems(task, activityData);
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
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = null;
    pendingRef.current = [];
    initializedRef.current = false;
    seedIdsRef.current = new Set(itemsRef.current.map((item) => item.id));
    seenIdsRef.current = new Set(seedIdsRef.current);
    setAnnounce('');
    setGalleryOpen(false);
    setGalleryArtifactId(null);
    setOptimisticRejectedKeys(new Set());
    setPage(1);
    setRejectedPage(1);
    setRejectedOpen(false);
    setSelectedWorkerKey(null);
    scopedSeedKeyRef.current = null;
    scopedSeedIdsRef.current = new Set();
  }, [visibilityScopeKey]);

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

    const unseen = current.filter((item) => !seenIdsRef.current.has(item.id));
    unseen.forEach((item) => seenIdsRef.current.add(item.id));
    const fresh = unseen.filter((item) => !scopedSeedIdsRef.current.has(item.id));
    if (fresh.length === 0) {
      return;
    }

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

      const message = submissionReviewEligible
        ? batch.length === 1
          ? `New submitter from ${batch[0]?.actor ?? 'a worker'}`
          : `${batch.length} new submitters`
        : batch.length === 1
          ? `New ${noun.singular} from ${batch[0]?.actor ?? 'a worker'}`
          : `${batch.length} new ${noun.plural}`;
      toast(message);
      setAnnounce(message);
    }, TOAST_DEBOUNCE_MS);
    // Keyed on the stable id signature so the effect only runs when membership
    // changes; itemsRef gives the effect the latest list without re-subscribing.
  }, [itemSignature, noun.plural, noun.singular, requesterAffordances, submissionReviewEligible]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const windowOpen = isOpenForWork(task);
  // The submission window closing means intake has stopped for good (never reopens on
  // its own), so a pulsing "Live" dot next to "Submission window closed" reads as a
  // straight contradiction -- fold both facts into one line instead of showing both
  // indicators side by side.
  const submissionWindowClosed = task.status === 'open' && !windowOpen;
  const title = submissionReviewEligible ? 'Submission review' : 'Activity';
  const description = submissionReviewEligible
    ? 'Compare deliverables before releasing escrow.'
    : 'Work, bids, proofs, and reviews tied to this task.';

  const showReaching =
    isRequester && task.status === 'open' && !hasActivity && !terminal && windowOpen;
  const animateNew = pollEnabled && !motionDisabled;

  useEffect(() => {
    if (optimisticRejectedKeys.size === 0) return;
    const confirmedKeys = new Set(
      groupSubmissionsByWorker(visibleSubmissions).rejectedGroups.map((group) => group.workerKey)
    );
    setOptimisticRejectedKeys((current) => {
      const pending = new Set([...current].filter((workerKey) => !confirmedKeys.has(workerKey)));
      return pending.size === current.size ? current : pending;
    });
  }, [optimisticRejectedKeys.size, visibleSubmissions]);

  const rejectedTotalPages = Math.max(1, Math.ceil(rejectedGroups.length / PAGE_SIZE));

  useEffect(() => {
    setRejectedPage((current) => Math.min(current, rejectedTotalPages));
  }, [rejectedTotalPages]);

  const openHistory = (group: WorkerSubmissionGroup, source: 'active' | 'rejected') => {
    historyOriginRef.current = {
      activePage: currentPage,
      rejectedPage,
      scrollY: window.scrollY,
      source,
      workerKey: group.workerKey,
    };
    setSelectedWorkerKey(group.workerKey);
  };

  const restoreHistoryOrigin = () => {
    const origin = historyOriginRef.current;
    setSelectedWorkerKey(null);
    if (!origin) return;

    const currentRejectedIndex = rejectedGroups.findIndex(
      (group) => group.workerKey === origin.workerKey
    );
    const currentActiveIndex = activeGroups.findIndex(
      (group) => group.workerKey === origin.workerKey
    );

    if (currentRejectedIndex >= 0) {
      setRejectedOpen(true);
      setRejectedPage(Math.floor(currentRejectedIndex / PAGE_SIZE) + 1);
    } else {
      setPage(
        currentActiveIndex >= 0 ? Math.floor(currentActiveIndex / PAGE_SIZE) + 1 : origin.activePage
      );
      if (origin.source === 'rejected') {
        setRejectedOpen(true);
        setRejectedPage(origin.rejectedPage);
      }
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const target = document.querySelector<HTMLElement>(
          `[data-testid="submitter-history-origin-${origin.workerKey}"]`
        );
        (target ?? reviewHeadingRef.current)?.focus({ preventScroll: true });
        if (!window.navigator.userAgent.includes('jsdom')) {
          window.scrollTo({ behavior: 'instant', top: origin.scrollY });
        }
      });
    });
  };

  useEffect(() => {
    if (!selectedWorkerKey || selectedGroup) return;

    setAnnounce('This submitter is no longer available. Returned to all submitters.');
    setSelectedWorkerKey(null);
    window.requestAnimationFrame(() => reviewHeadingRef.current?.focus({ preventScroll: true }));
  }, [selectedGroup, selectedWorkerKey]);

  const handleRejectSuccess = (workerKey: string) => {
    setOptimisticRejectedKeys((current) => new Set(current).add(workerKey));
    if (usesScopedSubmissions) {
      setScopedRefreshVersion((current) => current + 1);
    } else {
      void utils.submissions.listByTask.invalidate();
    }
  };

  if (submissionReviewEligible && selectedGroup) {
    return (
      <section className="grid gap-5" id="task-activity">
        <span aria-live="polite" className="sr-only">
          {announce}
        </span>
        <div className="grid gap-1">
          <h2
            className="font-display font-semibold leading-none tracking-tight text-foreground outline-none"
            ref={reviewHeadingRef}
            tabIndex={-1}
          >
            Submission review
          </h2>
          <p className="text-sm leading-5 text-muted-foreground">
            Compare deliverables before releasing escrow.
          </p>
        </div>
        <WorkerSubmissionHistory
          actionArea={
            isRequester ? (
              <WorkerSubmissionActions
                acceptAction={reviewActions?.acceptAction}
                group={selectedGroup}
                onRejectSuccess={handleRejectSuccess}
                rejectAction={reviewActions?.rejectAction}
                task={task}
              />
            ) : undefined
          }
          group={selectedGroup}
          initialView={reviewView}
          onBack={restoreHistoryOrigin}
          profileBasePath={profileBasePath}
          task={task}
          visibilityScopeKey={visibilityScopeKey}
        />
      </section>
    );
  }

  return (
    <section
      className={cn('grid gap-5', submissionReviewEligible ? '' : 'border-t border-border/58 pt-5')}
      id="task-activity"
      tabIndex={-1}
    >
      <span aria-live="polite" className="sr-only">
        {announce}
      </span>
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <div className="flex items-center gap-3">
              <h2
                className="font-display font-semibold leading-none tracking-tight text-foreground outline-none"
                ref={reviewHeadingRef}
                tabIndex={-1}
              >
                {title}
              </h2>
              {!submissionReviewEligible && pollEnabled && !submissionWindowClosed ? (
                <LiveIndicator motionDisabled={motionDisabled} />
              ) : null}
              {!submissionReviewEligible && submissionWindowClosed ? (
                <span className="font-mono text-[0.7rem] uppercase tracking-[0.08em] text-muted-foreground">
                  Submission window closed
                </span>
              ) : null}
            </div>
            <p className="text-sm leading-5 text-muted-foreground">{description}</p>
          </div>
          <div className="flex items-center gap-2">
            {galleryEntries.length > 0 ? (
              <Button
                onClick={() => {
                  setGalleryArtifactId(null);
                  setGalleryOpen(true);
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                <Images className="size-3.5" />
                Gallery
              </Button>
            ) : null}
            {!submissionReviewEligible ? (
              <Badge variant="terminal">{activityLabel(task, data)}</Badge>
            ) : null}
          </div>
        </div>
      </div>
      <div className="grid gap-3">
        {activeGroups.length > 0 && submissionReviewEligible ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2" role="group" aria-label="Submission view">
              <Button
                aria-label="Gallery view"
                aria-pressed={reviewView === 'gallery'}
                data-active={reviewView === 'gallery'}
                onClick={() => setReviewView('gallery')}
                size="chip"
                type="button"
                variant="chip"
              >
                <LayoutGridIcon className="size-3.5" />
                Gallery
              </Button>
              <Button
                aria-label="List view"
                aria-pressed={reviewView === 'list'}
                data-active={reviewView === 'list'}
                onClick={() => setReviewView('list')}
                size="chip"
                type="button"
                variant="chip"
              >
                <ListIcon className="size-3.5" />
                List
              </Button>
            </div>
            {activeGroups.length > 1 ? (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                Sort:
                <NativeSelect
                  aria-label="Sort submissions"
                  onChange={(event) => {
                    setReviewSort(event.target.value as ReviewSort);
                    setPage(1);
                  }}
                  value={reviewSort}
                  wrapperClassName="w-auto"
                >
                  {REVIEW_SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            ) : null}
          </div>
        ) : null}

        {submissionReviewEligible && groupedReview.totalSubmissionCount > 0 ? (
          <p
            className="font-mono text-xs text-muted-foreground"
            data-testid="submission-review-summary"
          >
            {activeGroups.length} active {activeGroups.length === 1 ? 'submitter' : 'submitters'}
            {' · '}
            {activeGroups.reduce((total, group) => total + group.submissions.length, 0)} active{' '}
            {activeGroups.reduce((total, group) => total + group.submissions.length, 0) === 1
              ? 'submission'
              : 'submissions'}
          </p>
        ) : null}

        {submissionReviewEligible && activeGroups.length === 0 && rejectedGroups.length > 0 ? (
          <div className="rounded-lg border border-dashed border-border/58 bg-background/30 p-4">
            <p className="text-sm font-semibold tracking-tight text-foreground">
              No active submissions to review.
            </p>
          </div>
        ) : null}

        {submissions.length > 0 && !submissionReviewEligible ? (
          <div className="grid items-start gap-3">
            <AnimatePresence initial={false}>
              {pagedSubmissions.map((submission) => (
                <AnimatedRow
                  animate={animateNew && !seedIds.has(submission.id)}
                  key={submission.id}
                  motionDisabled={motionDisabled}
                >
                  <SubmissionCard
                    layout="card"
                    onOpenMedia={openGalleryAt}
                    profileBasePath={profileBasePath}
                    submission={submission}
                    task={task}
                  />
                </AnimatedRow>
              ))}
            </AnimatePresence>
          </div>
        ) : null}

        {submissionReviewEligible && activeGroups.length > 0 ? (
          <div
            aria-label="Artifact comparison"
            className={cn(
              'grid',
              reviewView === 'gallery' ? 'items-stretch gap-5 md:grid-cols-2' : 'items-start gap-3'
            )}
            role="region"
          >
            <AnimatePresence initial={false}>
              {pagedActiveGroups.map((group) => (
                <AnimatedRow
                  animate={animateNew && !seedIds.has(group.workerKey)}
                  key={group.workerKey}
                  motionDisabled={motionDisabled}
                >
                  <div
                    aria-label={`Submitter ${actorDisplayName({
                      address: group.workerAddress,
                      agentId: group.representativeSubmission.workerAgentId,
                    })}, ${group.submissions.length} ${
                      group.submissions.length === 1 ? 'submission' : 'submissions'
                    }`}
                    className="grid min-w-0 gap-3"
                    data-testid={`submitter-group-${group.workerKey}`}
                    role="group"
                  >
                    <SubmissionCard
                      layout={reviewView}
                      onOpenMedia={openGalleryAt}
                      profileBasePath={profileBasePath}
                      submission={group.representativeSubmission}
                      task={task}
                    />
                    {group.submissions.length > 1 ? (
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="font-mono text-xs text-muted-foreground">
                          {group.submissions.length} submissions
                        </p>
                        <Button
                          aria-label={`View all ${group.submissions.length} submissions from ${actorDisplayName(
                            {
                              address: group.workerAddress,
                              agentId: group.representativeSubmission.workerAgentId,
                            }
                          )}`}
                          data-testid={`submitter-history-origin-${group.workerKey}`}
                          onClick={() => openHistory(group, 'active')}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          View {group.submissions.length} submissions
                        </Button>
                      </div>
                    ) : null}
                    {isRequester ? (
                      <WorkerSubmissionActions
                        acceptAction={reviewActions?.acceptAction}
                        group={group}
                        onRejectSuccess={handleRejectSuccess}
                        rejectAction={reviewActions?.rejectAction}
                        task={task}
                      />
                    ) : null}
                  </div>
                </AnimatedRow>
              ))}
            </AnimatePresence>
          </div>
        ) : null}

        <AnimatePresence initial={false}>
          {pagedPitches.map((pitch) => (
            <AnimatedRow
              animate={animateNew && !seedIds.has(pitch.id)}
              key={pitch.id}
              motionDisabled={motionDisabled}
            >
              <PitchRow pitch={pitch} profileBasePath={profileBasePath} />
            </AnimatedRow>
          ))}

          {pagedProofs.map((proof) => (
            <AnimatedRow
              animate={animateNew && !seedIds.has(proof.id)}
              key={proof.id}
              motionDisabled={motionDisabled}
            >
              <ProofRow profileBasePath={profileBasePath} proof={proof} task={task} />
            </AnimatedRow>
          ))}

          {pagedBids.map((bid) => (
            <AnimatedRow
              animate={animateNew && !seedIds.has(bid.id)}
              key={bid.id}
              motionDisabled={motionDisabled}
            >
              <BidRow bid={bid} profileBasePath={profileBasePath} />
            </AnimatedRow>
          ))}
        </AnimatePresence>

        {totalItems > PAGE_SIZE ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/58 pt-3">
            <p className="font-mono text-xs text-muted-foreground">
              Showing {pageStart + 1}-{Math.min(pageEnd, totalItems)} of {totalItems}
              {submissionReviewEligible ? ' submitters' : ''}
            </p>
            <div className="flex items-center gap-2">
              <Button
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
                size="icon-xs"
                type="button"
                variant="outline"
              >
                <ChevronLeftIcon aria-hidden />
                <span className="sr-only">Previous page</span>
              </Button>
              <span className="font-mono text-xs text-muted-foreground">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                disabled={currentPage >= totalPages}
                onClick={() => setPage(currentPage + 1)}
                size="icon-xs"
                type="button"
                variant="outline"
              >
                <ChevronRightIcon aria-hidden />
                <span className="sr-only">Next page</span>
              </Button>
            </div>
          </div>
        ) : null}

        {submissionReviewEligible && rejectedGroups.length > 0 ? (
          <details
            className="border-t border-border/58 pt-4"
            data-testid="rejected-submitters"
            onToggle={(event) => setRejectedOpen(event.currentTarget.open)}
            open={rejectedOpen}
          >
            <summary className="cursor-pointer select-none font-display font-semibold text-foreground">
              Rejected submitters ({rejectedGroups.length})
            </summary>
            <div className="mt-4 grid gap-3">
              {rejectedGroups
                .slice((rejectedPage - 1) * PAGE_SIZE, rejectedPage * PAGE_SIZE)
                .map((group) => (
                  <div
                    className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-border/52 bg-background/30 p-3"
                    key={group.workerKey}
                  >
                    <div className="grid min-w-0 gap-1">
                      <p className="truncate font-mono text-sm font-semibold text-foreground">
                        {actorDisplayName({
                          address: group.workerAddress,
                          agentId: group.representativeSubmission.workerAgentId,
                        })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {group.submissions.length}{' '}
                        {group.submissions.length === 1 ? 'submission' : 'submissions'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        First <RelativeTime value={group.firstSubmittedAt} />
                        {' · '}Latest <RelativeTime value={group.latestSubmittedAt} />
                      </p>
                    </div>
                    <Button
                      data-testid={`submitter-history-origin-${group.workerKey}`}
                      onClick={() => openHistory(group, 'rejected')}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      View history
                    </Button>
                  </div>
                ))}
              {rejectedGroups.length > PAGE_SIZE ? (
                <div className="flex items-center justify-between gap-3">
                  <Button
                    disabled={rejectedPage <= 1}
                    onClick={() => setRejectedPage((current) => current - 1)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Previous rejected
                  </Button>
                  <span className="font-mono text-xs text-muted-foreground">
                    Page {rejectedPage} of {rejectedTotalPages}
                  </span>
                  <Button
                    disabled={rejectedPage >= rejectedTotalPages}
                    onClick={() => setRejectedPage((current) => current + 1)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Next rejected
                  </Button>
                </div>
              ) : null}
            </div>
          </details>
        ) : null}

        {claim ? <ClaimRow claim={claim} profileBasePath={profileBasePath} /> : null}

        {!hasActivity ? (
          showReaching ? (
            <ReachingWorkersPanel
              marketStats={marketStats}
              motionDisabled={motionDisabled}
              task={task}
            />
          ) : submissionWindowClosed && (task.mode === 'bounty' || task.mode === 'benchmark') ? (
            <div className="rounded-lg border border-dashed border-border/58 bg-background/30 p-4">
              <p className="text-sm font-semibold tracking-tight text-foreground">
                Submission window closed
              </p>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                {task.mode === 'benchmark'
                  ? 'Submission window closed - reviewing benchmark proofs'
                  : 'Submission window closed - the requester is reviewing entries'}
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
      <SubmissionGalleryDialog
        entries={galleryEntries}
        entryPolicy={submissionReviewEligible ? 'snapshot-membership' : 'live'}
        initialArtifactId={galleryArtifactId}
        onOpenChange={setGalleryOpen}
        open={galleryOpen}
        profileBasePath={profileBasePath}
        sessionKey={`${visibilityScopeKey}:${submissionReviewEligible ? 'active-submitters' : 'activity'}`}
        taskId={task.id}
      />
      {secondarySubmissionReview ? (
        <BenchmarkSubmissionsSection
          initialSubmissions={initialModeData?.submissions}
          profileBasePath={profileBasePath}
          reviewActions={reviewActions}
          task={task}
        />
      ) : null}
    </section>
  );
}

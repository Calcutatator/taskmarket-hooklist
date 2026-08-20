'use client';

// Implements: ADR-0096

import type { TaskDetailResponse, TaskResponse } from '@taskmarket/shared';
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LayoutGridIcon,
  ListIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { RelativeTime } from '@/components/market/motion/relative-time';
import { usePanelOverlay, useUrlState } from '@/lib/url-state/use-url-state';
import {
  SubmissionGalleryDialog,
  submissionMediaEntries,
} from '@/components/market/submission-gallery';
import { ActorLink, SubmissionCard } from '@/components/market/tasks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { actorDisplayName } from '@/lib/format';
import type { WorkerSubmissionGroup } from '@/lib/market/submission-review';
import { cn } from '@/lib/utils';

const SUBMISSIONS_PER_PAGE = 12;

type HistorySort = 'newest' | 'oldest';
type HistoryView = 'gallery' | 'list';

export type WorkerSubmissionHistoryProps = {
  actionArea?: ReactNode;
  group: WorkerSubmissionGroup;
  initialView: HistoryView;
  onBack: () => void;
  profileBasePath: string;
  task: TaskDetailResponse | TaskResponse;
  visibilityScopeKey: string;
};

function submittedTime(value: string) {
  const time = Date.parse(value);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

function chronologicalSubmissions(group: WorkerSubmissionGroup) {
  return [...group.submissions].sort((left, right) => {
    const difference = submittedTime(left.submittedAt) - submittedTime(right.submittedAt);
    return difference || left.id.localeCompare(right.id);
  });
}

export function WorkerSubmissionHistory({
  actionArea,
  group,
  initialView,
  onBack,
  profileBasePath,
  task,
  visibilityScopeKey,
}: WorkerSubmissionHistoryProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // ADR-0096: view, sort, page and the open gallery are all shareable -- a second person opening
  // the link needs them to see this screen -- so they live in the URL and nowhere else. The names
  // are qualified because the task page around this panel owns its own view/sort.
  const [viewParam, setViewParam] = useUrlState('historyView', { history: 'refine' });
  const [sortParam, setSortParam] = useUrlState('historySort', { history: 'refine' });
  const [pageParam, setPageParam] = useUrlState('historyPage', { history: 'navigate' });
  const gallery = usePanelOverlay(`history:${group.workerKey}`);

  const view: HistoryView =
    viewParam === 'list' || viewParam === 'gallery' ? viewParam : initialView;
  const sort: HistorySort = sortParam === 'oldest' ? 'oldest' : 'newest';
  const page = Math.max(1, Number.parseInt(pageParam, 10) || 1);
  const setView = (next: HistoryView) => setViewParam(next === initialView ? '' : next);
  const setSort = (next: HistorySort) => setSortParam(next === 'newest' ? '' : next);
  const setPage = (next: number) => setPageParam(next <= 1 ? '' : String(next));
  const galleryOpen = gallery.isOpen;
  const galleryArtifactId = gallery.itemId || null;
  const [announcement, setAnnouncement] = useState('');
  const observedCountRef = useRef({
    count: group.submissions.length,
    scopeKey: `${visibilityScopeKey}:${group.workerKey}`,
  });

  const scopeKey = `${visibilityScopeKey}:${group.workerKey}`;
  const workerLabel = actorDisplayName({
    address: group.workerAddress,
    agentId: group.representativeSubmission.workerAgentId,
  });
  const orderedSubmissions = useMemo(() => {
    const chronological = chronologicalSubmissions(group);
    return sort === 'oldest' ? chronological : chronological.reverse();
  }, [group, sort]);
  const ordinalById = useMemo(
    () =>
      new Map(
        chronologicalSubmissions(group).map((submission, index) => [submission.id, index + 1])
      ),
    [group]
  );
  const totalPages = Math.max(1, Math.ceil(orderedSubmissions.length / SUBMISSIONS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * SUBMISSIONS_PER_PAGE;
  const pageEnd = pageStart + SUBMISSIONS_PER_PAGE;
  const pagedSubmissions = orderedSubmissions.slice(pageStart, pageEnd);
  const galleryEntries = submissionMediaEntries(group.submissions);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    const observed = observedCountRef.current;
    if (observed.scopeKey !== scopeKey) {
      observedCountRef.current = { count: group.submissions.length, scopeKey };
      setAnnouncement('');
      // The gallery and page are URL state now, so a scope change does not silently rewrite the
      // address the viewer arrived on.
      return;
    }

    if (group.submissions.length > observed.count) {
      const added = group.submissions.length - observed.count;
      setAnnouncement(`${added} new ${added === 1 ? 'submission' : 'submissions'} added`);
    }
    observedCountRef.current = { count: group.submissions.length, scopeKey };
  }, [group.submissions.length, scopeKey]);

  return (
    <section
      aria-labelledby="submitter-history-heading"
      className="grid min-w-0 gap-5"
      data-testid="submitter-history"
    >
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
      <div className="grid gap-4 border-b border-border/58 pb-4">
        <Button
          className="w-fit"
          data-testid="submitter-history-back"
          onClick={onBack}
          size="sm"
          type="button"
          variant="ghost"
        >
          <ArrowLeftIcon aria-hidden className="size-4" />
          Back to all submitters
        </Button>
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
          <div className="grid min-w-0 gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3
                className="font-display text-lg font-semibold tracking-tight text-foreground outline-none"
                id="submitter-history-heading"
                ref={headingRef}
                tabIndex={-1}
              >
                Submitter history
              </h3>
              <Badge variant={group.rejected ? 'terminal' : 'outline'}>
                {group.rejected ? 'Rejected' : 'Active'}
              </Badge>
            </div>
            <ActorLink
              address={group.workerAddress}
              agentId={group.representativeSubmission.workerAgentId}
              className="w-fit max-w-full truncate font-mono text-sm font-semibold hover:text-primary"
              label={workerLabel}
              profileBasePath={profileBasePath}
              title={group.workerAddress}
            />
            <p className="font-mono text-sm text-foreground">
              {group.submissions.length}{' '}
              {group.submissions.length === 1 ? 'submission' : 'submissions'}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span>
                First submitted <RelativeTime value={group.firstSubmittedAt} />
              </span>
              <span>
                Latest update <RelativeTime value={group.latestSubmittedAt} />
              </span>
            </div>
          </div>
          {!group.rejected && actionArea ? (
            <div className="w-full min-w-0 sm:max-w-md">{actionArea}</div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div aria-label="Submission history view" className="flex items-center gap-2" role="group">
          <Button
            aria-label="Gallery view"
            aria-pressed={view === 'gallery'}
            data-active={view === 'gallery'}
            onClick={() => setView('gallery')}
            size="chip"
            type="button"
            variant="chip"
          >
            <LayoutGridIcon className="size-3.5" />
            Gallery
          </Button>
          <Button
            aria-label="List view"
            aria-pressed={view === 'list'}
            data-active={view === 'list'}
            onClick={() => setView('list')}
            size="chip"
            type="button"
            variant="chip"
          >
            <ListIcon className="size-3.5" />
            List
          </Button>
        </div>
        {group.submissions.length > 1 ? (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Sort:
            <NativeSelect
              aria-label="Sort submitter history"
              onChange={(event) => {
                setSort(event.target.value as HistorySort);
                setPage(1);
              }}
              value={sort}
              wrapperClassName="w-auto"
            >
              <option value="newest">Newest submissions</option>
              <option value="oldest">Oldest submissions</option>
            </NativeSelect>
          </label>
        ) : null}
      </div>

      <div
        className={cn(
          'grid min-w-0',
          view === 'gallery'
            ? 'items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3'
            : 'items-start gap-3'
        )}
      >
        {pagedSubmissions.map((submission) => {
          const ordinal = ordinalById.get(submission.id) ?? 1;
          const versionLabel = `Submission ${ordinal} of ${group.submissions.length} from ${workerLabel}`;
          const statusLabel = group.rejected
            ? submission.rejectedAt
              ? 'Rejected'
              : 'Rejected with submitter'
            : submission.id === group.representativeSubmission.id
              ? 'Latest active'
              : null;

          return (
            <section
              aria-label={versionLabel}
              className="grid min-w-0 gap-2"
              key={submission.id}
              role="region"
            >
              <div className="flex min-w-0 items-center justify-between gap-2">
                <p className="font-mono text-xs text-muted-foreground">
                  Submission {ordinal} of {group.submissions.length}
                </p>
                {statusLabel ? (
                  <Badge variant={group.rejected ? 'terminal' : 'outline'}>{statusLabel}</Badge>
                ) : null}
              </div>
              <SubmissionCard
                layout={view}
                onOpenMedia={(artifactId) => {
                  gallery.open(artifactId);
                }}
                profileBasePath={profileBasePath}
                submission={submission}
                task={task}
              />
            </section>
          );
        })}
      </div>

      {orderedSubmissions.length > SUBMISSIONS_PER_PAGE ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/58 pt-3">
          <p className="font-mono text-xs text-muted-foreground">
            Showing {pageStart + 1}-{Math.min(pageEnd, orderedSubmissions.length)} of{' '}
            {orderedSubmissions.length} submissions
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

      <SubmissionGalleryDialog
        contextLabel={group.rejected ? 'Rejected submission history' : undefined}
        entries={galleryEntries}
        entryPolicy="snapshot-membership"
        initialArtifactId={galleryArtifactId}
        onEntryChange={(entry) => gallery.select(entry.artifact.id)}
        onOpenChange={(next) => {
          if (!next) gallery.close();
        }}
        open={galleryOpen}
        profileBasePath={profileBasePath}
        sessionKey={`${scopeKey}:${group.rejected ? 'rejected' : 'active'}`}
        taskId={task.id}
      />
    </section>
  );
}

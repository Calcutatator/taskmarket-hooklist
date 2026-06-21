'use client';

import type { ArtifactResponse, TaskResponse } from '@taskmarket/shared';
import { LayoutGrid, Rows3 } from 'lucide-react';
import { useState } from 'react';

import { ArtifactMediaTile } from '@/components/market/artifact-preview-button';
import { TaskTable, type TaskListView } from '@/components/market/tasks';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/api/client';

function isMediaArtifact(artifact: ArtifactResponse) {
  return artifact.mediaKind === 'image' || artifact.mediaKind === 'video';
}

// Lazily fetch the first media artifact submitted to a task and render it as a small tile.
// Only mount this for tasks that already indicate submissions exist (subs > 0): a paginated
// feed of ~12-20 rows then issues a bounded number of requests rather than one per row.
//
// N+1 tradeoff: this fires one submissions.listByTask request per visible task that has
// submissions. React Query caches and dedupes by query key, so a task that also appears in
// the live-activity feed reuses the same response. A future backend "cover preview" field
// on TaskResponse (a single presigned thumbnail URL) would let the feed render covers with
// zero extra requests and should replace this component when available.
export function TaskThumbnail({ taskId }: { taskId: string }) {
  const { data } = trpc.submissions.listByTask.useQuery(
    // listByTask has no limit input; we fetch with media preview URLs and pick the first
    // media artifact client-side. The payload is small (artifact metadata + presigned URLs).
    { includePreviewUrls: 'media', taskId },
    {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    }
  );

  const cover = (data ?? [])
    .flatMap((submission) => submission.artifacts ?? [])
    .filter(isMediaArtifact)
    .filter((artifact) => Boolean(artifact.previewUrl))[0];

  // Hide entirely when the task has no embeddable media yet, so the cell stays clean.
  if (!cover) {
    return null;
  }

  return (
    <div className="w-full max-w-40">
      <ArtifactMediaTile artifact={cover} taskId={taskId} />
    </div>
  );
}

// Client wrapper that lets a viewer flip the task list between the lightweight table and an
// image-forward gallery (which mounts TaskThumbnail per active task). Kept here, in the
// client module, so TaskListPageContent (a server component) can stay server-rendered and
// simply mount this island. The table remains the default so the first paint is light.
export function TaskListBoard({
  createHref,
  detailBasePath = '/dashboard/tasks',
  errorMessage,
  hasActiveFilters,
  listHref,
  tasks,
}: {
  createHref?: string;
  detailBasePath?: string;
  errorMessage?: string;
  hasActiveFilters?: boolean;
  listHref?: string;
  tasks: TaskResponse[];
}) {
  const [view, setView] = useState<TaskListView>('table');

  return (
    <div className="grid gap-3">
      {/* Hide the toggle in error/empty states where there is nothing to lay out. */}
      {!errorMessage && tasks.length > 0 ? (
        <div className="flex items-center justify-end gap-1.5">
          <span className="mr-1 font-mono text-xs uppercase text-muted-foreground">View</span>
          <Button
            aria-label="Table view"
            aria-pressed={view === 'table'}
            data-active={view === 'table'}
            onClick={() => setView('table')}
            size="chip"
            type="button"
            variant="chip"
          >
            <Rows3 className="size-3" />
            Table
          </Button>
          <Button
            aria-label="Gallery view"
            aria-pressed={view === 'gallery'}
            data-active={view === 'gallery'}
            onClick={() => setView('gallery')}
            size="chip"
            type="button"
            variant="chip"
          >
            <LayoutGrid className="size-3" />
            Gallery
          </Button>
        </div>
      ) : null}
      <TaskTable
        createHref={createHref}
        detailBasePath={detailBasePath}
        errorMessage={errorMessage}
        hasActiveFilters={hasActiveFilters}
        listHref={listHref}
        tasks={tasks}
        view={view}
      />
    </div>
  );
}

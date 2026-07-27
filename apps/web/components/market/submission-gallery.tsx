'use client';

import type { ArtifactResponse, SubmissionResponse } from '@taskmarket/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState, type KeyboardEvent } from 'react';

import { ArtifactMetadata } from '@/components/market/artifact-preview-button';
import { RelativeTime } from '@/components/market/motion/relative-time';
import { ActorLink } from '@/components/market/tasks';
import {
  usableArtifactPreviewUrl,
  useArtifactPreviewUrl,
} from '@/components/market/use-artifact-preview-url';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { compactAddress } from '@/lib/format';
import { isMediaArtifact } from '@/lib/market/task-cover';

export type SubmissionMediaEntry = {
  artifact: ArtifactResponse;
  submission: SubmissionResponse;
};

// Flatten every submission's media artifacts into one ordered list (feed order,
// then artifact order) so the gallery can page through all deliverables at once.
export function submissionMediaEntries(submissions: SubmissionResponse[]): SubmissionMediaEntry[] {
  return submissions.flatMap((submission) =>
    (submission.artifacts ?? [])
      .filter(isMediaArtifact)
      .map((artifact) => ({ artifact, submission }))
  );
}

type SubmissionGalleryDialogProps = {
  entries: SubmissionMediaEntry[];
  initialIndex: number;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  profileBasePath: string;
  taskId: string;
};

export function SubmissionGalleryDialog(props: SubmissionGalleryDialogProps) {
  if (props.entries.length === 0) {
    return null;
  }

  return <SubmissionGalleryDialogInner {...props} />;
}

function SubmissionGalleryDialogInner({
  entries,
  initialIndex,
  onOpenChange,
  open,
  profileBasePath,
  taskId,
}: SubmissionGalleryDialogProps) {
  const [index, setIndex] = useState(initialIndex);

  // Re-anchor to the requested entry each time the dialog opens (heroes and
  // thumbnails open the gallery at their own artifact).
  useEffect(() => {
    if (open) {
      setIndex(initialIndex);
    }
  }, [initialIndex, open]);

  // The entries list refreshes with every poll, so clamp rather than trust the
  // stored index to still be in range.
  const count = entries.length;
  const safeIndex = Math.min(Math.max(index, 0), count - 1);
  const entry = entries[safeIndex] as SubmissionMediaEntry;
  const { artifact, submission } = entry;
  const workerLabel = compactAddress(submission.workerAgentId ?? submission.workerAddress);

  const { ensurePreviewUrl, error, loading, previewUrl } = useArtifactPreviewUrl(taskId, artifact);

  useEffect(() => {
    if (!open || previewUrl || loading || error) {
      return;
    }

    void ensurePreviewUrl();
  }, [ensurePreviewUrl, error, loading, open, previewUrl]);

  // Warm the browser cache for the two adjacent images so paging feels instant.
  useEffect(() => {
    if (!open || count < 2) {
      return;
    }

    [entries[(safeIndex + 1) % count], entries[(safeIndex - 1 + count) % count]].forEach(
      (neighbor) => {
        if (!neighbor || neighbor.artifact.mediaKind !== 'image') {
          return;
        }

        const url = usableArtifactPreviewUrl(neighbor.artifact);
        if (url) {
          new window.Image().src = url;
        }
      }
    );
  }, [count, entries, open, safeIndex]);

  const goPrev = () => setIndex((safeIndex - 1 + count) % count);
  const goNext = () => setIndex((safeIndex + 1) % count);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (count < 2) {
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goPrev();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      goNext();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-label="Submission gallery"
        className="max-h-[92vh] max-w-6xl gap-3 overflow-auto"
        onKeyDown={handleKeyDown}
      >
        <span aria-live="polite" className="sr-only">
          {`Item ${safeIndex + 1} of ${count}: ${artifact.fileName}`}
        </span>
        <DialogHeader>
          <DialogTitle className="break-all pr-8 font-mono">{artifact.fileName}</DialogTitle>
          <DialogDescription>
            Submitted by{' '}
            <ActorLink
              address={submission.workerAddress}
              agentId={submission.workerAgentId}
              className="font-mono text-foreground hover:text-primary"
              label={workerLabel}
              profileBasePath={profileBasePath}
              title={submission.workerAddress}
            />{' '}
            <RelativeTime value={submission.submittedAt} />
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <div className="grid h-[62vh] place-items-center overflow-hidden rounded-xl border border-border/60 bg-background/52">
            {error ? (
              <div className="grid justify-items-center gap-3 p-4 text-center text-sm text-destructive">
                <p>{error}</p>
                <Button
                  disabled={loading}
                  onClick={() => void ensurePreviewUrl(true)}
                  size="sm"
                  type="button"
                >
                  Retry
                </Button>
              </div>
            ) : !previewUrl ? (
              <p className="p-4 text-sm text-muted-foreground">Loading artifact preview...</p>
            ) : artifact.mediaKind === 'image' ? (
              <img
                alt={artifact.fileName}
                className="min-h-0 h-full w-full object-contain"
                src={previewUrl}
              />
            ) : (
              <video className="max-h-full max-w-full" controls src={previewUrl}>
                <a href={previewUrl} rel="noreferrer" target="_blank">
                  Open artifact
                </a>
              </video>
            )}
          </div>
          {count > 1 ? (
            <>
              <Button
                aria-label="Previous submission"
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full"
                onClick={goPrev}
                size="icon"
                type="button"
                variant="outline"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                aria-label="Next submission"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full"
                onClick={goNext}
                size="icon"
                type="button"
                variant="outline"
              >
                <ChevronRight className="size-4" />
              </Button>
            </>
          ) : null}
        </div>
        <div className="grid gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            {safeIndex + 1} / {count}
          </span>
          <details>
            <summary className="cursor-pointer select-none font-mono text-xs uppercase text-muted-foreground hover:text-foreground">
              Details
            </summary>
            <div className="mt-2">
              <ArtifactMetadata artifact={artifact} previewUrl={previewUrl} />
            </div>
          </details>
        </div>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import type { ArtifactResponse, SubmissionResponse } from '@taskmarket/shared';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, X } from 'lucide-react';
import { motion } from 'motion/react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
} from 'react';

import { ArtifactMetadata } from '@/components/market/artifact-preview-button';
import {
  InteractiveHtmlPreview,
  UntrustedHtmlWarningChip,
} from '@/components/market/interactive-html-preview';
import { useMotionDisabled } from '@/components/market/motion/use-motion-disabled';
import { RelativeTime } from '@/components/market/motion/relative-time';
import { ResilientArtifactVideo } from '@/components/market/resilient-artifact-video';
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
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { useIsMobile } from '@/hooks/use-mobile';
import { actorDisplayName } from '@/lib/format';
import {
  countSubmissionArtifactTypes,
  defaultSubmissionArtifactFilter,
  matchesSubmissionArtifactFilter,
  type SubmissionArtifactFilter,
  type SubmissionArtifactType,
} from '@/lib/market/submission-artifact-filter';
import { isPlayableArtifact } from '@/lib/market/task-cover';
import { isInteractiveHtmlArtifact } from '@/lib/sandboxed-html';
import { cn } from '@/lib/utils';

const easeOut = [0.16, 1, 0.3, 1] as const;

// A swipe shorter than this reads as an accidental tap/jitter, not navigation intent.
const SWIPE_THRESHOLD_PX = 48;

const ARTIFACT_FILTER_LABELS: Record<SubmissionArtifactFilter, string> = {
  all: 'All',
  html: 'HTML',
  image: 'Images',
  video: 'Video',
};

const INTERACTIVE_GALLERY_TARGETS = [
  'a[href]',
  'audio[controls]',
  'button',
  'input',
  'select',
  'summary',
  'textarea',
  'video[controls]',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="link"]',
  '[role="slider"]',
  '[role="textbox"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

type SlideOffset = -1 | 0 | 1;

type GallerySlot = {
  index: number;
  offset: SlideOffset;
};

// The window is always centered on the current index and never grows past 3 slots,
// no matter how many entries the feed has -- this is what keeps a 50-entry gallery
// from ever mounting more than 3 media panes (iframes especially) at once. Below 3
// total entries the previous/next slots collapse onto the same index, so they
// dedupe to avoid mounting the same artifact twice.
function gallerySlots(currentIndex: number, count: number): GallerySlot[] {
  if (count <= 0) {
    return [];
  }
  if (count === 1) {
    return [{ index: currentIndex, offset: 0 }];
  }

  const prevIndex = (currentIndex - 1 + count) % count;
  const nextIndex = (currentIndex + 1) % count;

  if (count === 2) {
    // prevIndex === nextIndex here; one slot for the other entry is enough.
    return [
      { index: prevIndex, offset: -1 },
      { index: currentIndex, offset: 0 },
    ];
  }

  return [
    { index: prevIndex, offset: -1 },
    { index: currentIndex, offset: 0 },
    { index: nextIndex, offset: 1 },
  ];
}

export type SubmissionMediaEntry = {
  artifact: ArtifactResponse;
  submission: SubmissionResponse;
};

// Flatten every submission's media artifacts into one ordered list (feed order,
// then artifact order) so the gallery can page through all deliverables at once.
export function submissionMediaEntries(submissions: SubmissionResponse[]): SubmissionMediaEntry[] {
  return submissions.flatMap((submission) =>
    (submission.artifacts ?? [])
      .filter(isPlayableArtifact)
      .map((artifact) => ({ artifact, submission }))
  );
}

// The gallery's own frame for an interactive HTML artifact: a fixed-height
// container (grid-rows-[auto_1fr]) so the warning note sits above an iframe that
// fills the rest of the frame, instead of the fixed-vh sizing the standalone
// preview dialog uses.
const GALLERY_HTML_CLASS_NAMES = {
  container: 'grid h-full w-full grid-rows-[auto_1fr] gap-3 px-3 pb-3 pt-14',
  error: 'grid justify-items-center gap-3 p-4 text-center text-sm text-destructive',
  iframe: 'h-full w-full rounded-xl border border-border/60 bg-background/52',
  message: 'p-4 text-center text-sm text-muted-foreground',
};

// The mobile variant never renders the inline warning note (it moves to the
// compact footer chip below the playfield instead, see the Drawer branch of
// SubmissionGalleryDialogInner) -- so the grid gets a single fluid row instead of
// an auto-sized row reserved for a note that is never mounted here (reusing the
// two-row track for an empty row would leave the iframe's height indeterminate),
// and drops the padding so the iframe reaches the frame's own border edge-to-edge,
// every pixel of which is scarce on a phone-sized playfield.
const GALLERY_HTML_CLASS_NAMES_COMPACT = {
  ...GALLERY_HTML_CLASS_NAMES,
  container: 'grid h-full w-full grid-rows-[1fr]',
};

type SubmissionGalleryDialogProps = {
  contextLabel?: string;
  entries: SubmissionMediaEntry[];
  entryPolicy?: SubmissionGalleryEntryPolicy;
  initialArtifactId: string | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  preferredArtifactType?: SubmissionArtifactType | null;
  profileBasePath: string;
  sessionKey?: string;
  taskId: string;
};

export type SubmissionGalleryEntryPolicy = 'live' | 'snapshot-membership';

export function SubmissionGalleryDialog(props: SubmissionGalleryDialogProps) {
  const { entries, entryPolicy = 'live', onOpenChange, open, sessionKey = props.taskId } = props;
  const [capturedEntries, setCapturedEntries] = useState<SubmissionMediaEntry[] | null>(null);
  const previousSessionKeyRef = useRef(sessionKey);
  const sessionChanged = previousSessionKeyRef.current !== sessionKey;

  useEffect(() => {
    if (!sessionChanged) {
      return;
    }

    previousSessionKeyRef.current = sessionKey;
    setCapturedEntries(null);
    if (open) {
      onOpenChange(false);
    }
  }, [onOpenChange, open, sessionChanged, sessionKey]);

  useEffect(() => {
    if (entryPolicy !== 'snapshot-membership' || !open) {
      setCapturedEntries(null);
      return;
    }

    if (capturedEntries === null && entries.length > 0) {
      setCapturedEntries(entries.map((entry) => entry));
    }
  }, [capturedEntries, entries, entryPolicy, open, sessionKey]);

  const latestEntriesById = new Map(entries.map((entry) => [entry.artifact.id, entry]));
  const sessionEntries =
    entryPolicy === 'snapshot-membership' && capturedEntries
      ? capturedEntries.map((captured) => latestEntriesById.get(captured.artifact.id) ?? captured)
      : entries;

  if (sessionChanged || sessionEntries.length === 0) {
    return null;
  }

  return <SubmissionGalleryDialogInner {...props} entries={sessionEntries} key={sessionKey} />;
}

function SubmissionGalleryDialogInner({
  contextLabel,
  entries,
  initialArtifactId,
  onOpenChange,
  open,
  preferredArtifactType,
  profileBasePath,
  taskId,
}: SubmissionGalleryDialogProps) {
  const [selectedArtifactId, setSelectedArtifactId] = useState(initialArtifactId);
  const [fullViewport, setFullViewport] = useState(false);
  const motionDisabled = useMotionDisabled();
  const artifactTypeCounts = useMemo(
    () => countSubmissionArtifactTypes(entries.map((entry) => entry.artifact)),
    [entries]
  );
  const requestedArtifact = initialArtifactId
    ? entries.find((entry) => entry.artifact.id === initialArtifactId)?.artifact
    : undefined;
  const defaultArtifactFilter = defaultSubmissionArtifactFilter(
    artifactTypeCounts,
    preferredArtifactType
  );
  // Opening a specific thumbnail is an explicit viewer choice: keep the full
  // carousel available and anchor to that artifact. Automatic or creator defaults
  // apply only when the gallery itself is opened without a requested artifact.
  const initialArtifactFilter = requestedArtifact ? 'all' : defaultArtifactFilter;
  const [artifactFilter, setArtifactFilter] =
    useState<SubmissionArtifactFilter>(initialArtifactFilter);
  const wasOpenRef = useRef(false);
  const filteredEntries = useMemo(
    () =>
      entries.filter((entry) => matchesSubmissionArtifactFilter(entry.artifact, artifactFilter)),
    [artifactFilter, entries]
  );
  const visibleEntries = filteredEntries.length > 0 ? filteredEntries : entries;

  // Re-anchor to the requested entry each time the dialog opens (heroes and
  // thumbnails open the gallery at their own artifact).
  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (!justOpened) {
      return;
    }

    const openingEntries = entries.filter((entry) =>
      matchesSubmissionArtifactFilter(entry.artifact, initialArtifactFilter)
    );
    setArtifactFilter(initialArtifactFilter);
    setSelectedArtifactId(
      openingEntries.some((entry) => entry.artifact.id === initialArtifactId)
        ? initialArtifactId
        : (openingEntries[0]?.artifact.id ?? entries[0]?.artifact.id ?? null)
    );
  }, [entries, initialArtifactFilter, initialArtifactId, open]);

  // A controlled dialog can also be closed by its parent (for example when the
  // active task or authorization scope changes), so reset independently of the
  // dialog's own close callback as well as handling user-initiated closes below.
  useEffect(() => {
    if (!open) {
      setFullViewport(false);
    }
  }, [open]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setFullViewport(false);
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange]
  );
  // The sandboxed document can relay Escape across its browsing-context boundary,
  // but its own untrusted scripts can send the same fixed signal. Limit the effect
  // to this reversible layout change; iframe messages can never close the dialog.
  const handlePreviewEscape = useCallback(() => setFullViewport(false), []);

  // Track the artifact rather than its position: the entries list refreshes with
  // every poll, and a newly submitted entry shifts every index below it. Fall back
  // to the first entry if the selected artifact is no longer in the feed.
  const count = visibleEntries.length;
  const selectedIndex = visibleEntries.findIndex((item) => item.artifact.id === selectedArtifactId);
  const safeIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const entry = visibleEntries[safeIndex] as SubmissionMediaEntry;
  const { artifact, submission } = entry;
  const workerLabel = actorDisplayName({
    address: submission.workerAddress,
    agentId: submission.workerAgentId,
  });

  // The Details disclosure below the frame reads the current entry's preview URL, but
  // that URL is now owned inside whichever GallerySlide is mounted at offset 0 (each
  // slide manages its own artifact independently -- see gallerySlots). This mirrors
  // the current slide's value back up without a second competing fetch for it.
  const [currentPreview, setCurrentPreview] = useState<{
    artifactId: string;
    previewUrl: string | null;
  }>({ artifactId: entry.artifact.id, previewUrl: null });
  const handleCurrentPreviewChange = useCallback(
    (artifactId: string, previewUrl: string | null) => {
      setCurrentPreview({ artifactId, previewUrl });
    },
    []
  );
  const detailsPreviewUrl =
    currentPreview.artifactId === artifact.id ? currentPreview.previewUrl : null;
  const [currentVideoAspect, setCurrentVideoAspect] = useState<{
    artifactId: string;
    ratio: number;
  } | null>(null);
  const handleCurrentVideoAspectChange = useCallback((artifactId: string, ratio: number) => {
    setCurrentVideoAspect({ artifactId, ratio });
  }, []);
  const currentVideoAspectRatio =
    currentVideoAspect?.artifactId === artifact.id ? currentVideoAspect.ratio : null;

  // Warm the browser cache for the two adjacent images so paging feels instant. The
  // previous/next GallerySlide instances also resolve their own preview URLs, but an
  // interactive HTML document is deliberately mounted only while current so its
  // scripts cannot keep running after the user advances.
  useEffect(() => {
    if (!open || count < 2) {
      return;
    }

    [
      visibleEntries[(safeIndex + 1) % count],
      visibleEntries[(safeIndex - 1 + count) % count],
    ].forEach((neighbor) => {
      if (!neighbor || neighbor.artifact.mediaKind !== 'image') {
        return;
      }

      const url = usableArtifactPreviewUrl(neighbor.artifact);
      if (url) {
        new window.Image().src = url;
      }
    });
  }, [count, open, safeIndex, visibleEntries]);

  const goTo = (nextIndex: number) =>
    setSelectedArtifactId(visibleEntries[nextIndex]?.artifact.id ?? null);
  const goPrev = () => goTo((safeIndex - 1 + count) % count);
  const goNext = () => goTo((safeIndex + 1) % count);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (count < 2) {
      return;
    }

    const target = event.target;
    if (
      target instanceof Element &&
      target !== event.currentTarget &&
      target.closest(INTERACTIVE_GALLERY_TARGETS)
    ) {
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

  // Swipe navigation lives on two narrow edge gutters inside the frame (rendered
  // below), never on the frame or content itself. An interactive HTML artifact
  // renders in an iframe that needs the entire play surface for its own touch
  // input, so nothing wider than the edges may intercept a pointer sequence.
  // Direction is derived from the horizontal delta between pointerdown and
  // pointerup; a mostly-vertical drag reads as a scroll gesture and is ignored.
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleSwipePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    swipeStartRef.current = { x: event.clientX, y: event.clientY };
  };

  const handleSwipePointerCancel = () => {
    swipeStartRef.current = null;
  };

  const handleSwipePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || count < 2) {
      return;
    }

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) < Math.abs(dy)) {
      return;
    }

    if (dx < 0) {
      goNext();
    } else {
      goPrev();
    }
  };

  const slots = gallerySlots(safeIndex, count);
  const isMobile = useIsMobile();
  const interactiveHtml = isInteractiveHtmlArtifact(artifact);
  const compactMobileVideo = isMobile && artifact.mediaKind === 'video';
  // Desktop keeps the inline three-line warning note (unchanged, established
  // behavior). Mobile suppresses it here and surfaces the same warning as a
  // collapsed chip in the sheet's topbar instead -- the two must never compete for
  // the same on-screen real estate as the worker/position overlay rail below.
  const showInlineWarning = !isMobile;

  const liveRegion = (
    <span aria-live="polite" className="sr-only">
      {`Item ${safeIndex + 1} of ${count}: ${artifact.fileName}`}
    </span>
  );

  const availableArtifactTypes = (['html', 'image', 'video'] as const).filter(
    (type) => artifactTypeCounts[type] > 0
  );
  const changeArtifactFilter = (nextFilter: SubmissionArtifactFilter) => {
    const nextEntries = entries.filter((item) =>
      matchesSubmissionArtifactFilter(item.artifact, nextFilter)
    );
    setArtifactFilter(nextFilter);
    if (!nextEntries.some((item) => item.artifact.id === selectedArtifactId)) {
      setSelectedArtifactId(nextEntries[0]?.artifact.id ?? null);
    }
  };
  const artifactFilterControls =
    availableArtifactTypes.length > 1 ? (
      <div
        aria-label="Filter gallery by file type"
        className="flex min-w-0 items-center gap-2 overflow-x-auto px-4 py-2 md:px-0"
        role="group"
      >
        <span className="shrink-0 font-mono text-[0.7rem] uppercase tracking-[0.08em] text-muted-foreground">
          Show
        </span>
        {(['all', ...availableArtifactTypes] as SubmissionArtifactFilter[]).map((filter) => {
          const filterCount =
            filter === 'all'
              ? entries.length
              : artifactTypeCounts[filter as SubmissionArtifactType];

          return (
            <Button
              aria-label={`Filter gallery to ${ARTIFACT_FILTER_LABELS[filter]}`}
              aria-pressed={artifactFilter === filter}
              className="shrink-0"
              data-active={artifactFilter === filter}
              key={filter}
              onClick={() => changeArtifactFilter(filter)}
              size="chip"
              type="button"
              variant="chip"
            >
              {ARTIFACT_FILTER_LABELS[filter]} {filterCount}
            </Button>
          );
        })}
        {artifactFilter === defaultArtifactFilter && defaultArtifactFilter !== 'all' ? (
          <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
            {preferredArtifactType === defaultArtifactFilter ? 'Task default' : 'Smart default'}
          </span>
        ) : null}
      </div>
    ) : null;

  const playfield = (
    <div
      className={cn(
        'relative',
        fullViewport && !isMobile && 'h-full min-h-0',
        isMobile && !compactMobileVideo && 'h-full',
        compactMobileVideo && 'w-full self-center'
      )}
    >
      <div
        className={cn(
          'relative overflow-hidden rounded-xl border border-border/60 bg-background/52',
          isMobile
            ? compactMobileVideo
              ? 'aspect-video w-full'
              : 'h-full'
            : fullViewport
              ? 'h-full'
              : 'h-[62vh]'
        )}
        data-testid="gallery-frame"
        style={
          compactMobileVideo ? { aspectRatio: currentVideoAspectRatio ?? '16 / 9' } : undefined
        }
      >
        {slots.map((slot) => {
          const slotEntry = visibleEntries[slot.index];
          if (!slotEntry) {
            return null;
          }

          return (
            <GallerySlide
              entry={slotEntry}
              key={slotEntry.artifact.id}
              motionDisabled={motionDisabled}
              offset={slot.offset}
              onCurrentPreviewChange={handleCurrentPreviewChange}
              onCurrentVideoAspectChange={handleCurrentVideoAspectChange}
              onPreviewEscape={fullViewport ? handlePreviewEscape : undefined}
              open={open}
              showWarning={showInlineWarning}
              taskId={taskId}
            />
          );
        })}
        {count > 1 ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-10 flex items-stretch justify-between"
          >
            <div
              className="pointer-events-auto w-10 touch-none sm:w-12"
              data-testid="gallery-swipe-gutter-start"
              onPointerCancel={handleSwipePointerCancel}
              onPointerDown={handleSwipePointerDown}
              onPointerUp={handleSwipePointerUp}
            />
            <div
              className="pointer-events-auto w-10 touch-none sm:w-12"
              data-testid="gallery-swipe-gutter-end"
              onPointerCancel={handleSwipePointerCancel}
              onPointerDown={handleSwipePointerDown}
              onPointerUp={handleSwipePointerUp}
            />
          </div>
        ) : null}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-3"
          data-testid="gallery-overlay-rail"
        >
          <span className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-background/72 px-2.5 py-1 text-xs text-foreground backdrop-blur">
            <ActorLink
              address={submission.workerAddress}
              agentId={submission.workerAgentId}
              className="font-mono text-foreground hover:text-primary"
              label={workerLabel}
              profileBasePath={profileBasePath}
              title={submission.workerAddress}
            />
            <RelativeTime value={submission.submittedAt} />
          </span>
          <span className="pointer-events-auto rounded-full bg-background/72 px-2.5 py-1 font-mono text-xs text-muted-foreground backdrop-blur">
            {safeIndex + 1} / {count}
          </span>
        </div>
      </div>
      {count > 1 ? (
        <>
          <Button
            aria-label="Previous artifact"
            className={cn(
              'absolute left-2 top-1/2 z-20 -translate-y-1/2',
              // Swipe is the primary gesture on mobile, and the frame needs its full
              // surface for content (including untrusted-HTML touch input) -- so the
              // chevron stays out of view and out of the pointer-event path there,
              // while remaining mounted and keyboard/AT reachable. It reappears (and
              // regains pointer events) the moment it receives keyboard focus, the
              // same reveal-on-focus pattern used for skip links.
              isMobile &&
                'pointer-events-none opacity-0 focus-visible:pointer-events-auto focus-visible:opacity-100'
            )}
            onClick={goPrev}
            size="icon"
            type="button"
            variant="outline"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            aria-label="Next artifact"
            className={cn(
              'absolute right-2 top-1/2 z-20 -translate-y-1/2',
              isMobile &&
                'pointer-events-none opacity-0 focus-visible:pointer-events-auto focus-visible:opacity-100'
            )}
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
  );

  const detailsSection = (
    <div className="grid gap-2">
      <details>
        <summary className="cursor-pointer select-none font-mono text-xs uppercase text-muted-foreground hover:text-foreground">
          Details
        </summary>
        <div className="mt-2">
          <ArtifactMetadata
            artifact={artifact}
            previewUrl={interactiveHtml ? null : detailsPreviewUrl}
          />
        </div>
      </details>
    </div>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange}>
        <DrawerContent
          // components/ui/drawer.tsx scopes its own height cap to
          // `data-[vaul-drawer-direction=bottom]:max-h-[80dvh]`. That combines a class
          // and an attribute selector, so a plain `max-h-[*]` here would lose the
          // cascade on specificity no matter the merge order. Repeating the same
          // variant prefix keeps the specificity equal and lets tailwind-merge drop the
          // primitive's default, so this override wins without an inline style. This
          // surface is taller than the per-artifact sheet because its fixed chrome
          // (drag handle, sr-only header, warning/details footer) leaves proportionally
          // less room -- both are tuned to the same bar: the playfield filling at least
          // 85% of the viewport height.
          className="data-[vaul-drawer-direction=bottom]:h-[96dvh] data-[vaul-drawer-direction=bottom]:max-h-[96dvh]"
          onKeyDown={handleKeyDown}
        >
          {liveRegion}
          <DrawerHeader className="sr-only">
            <DrawerTitle>{`Submission gallery: ${artifact.fileName}`}</DrawerTitle>
            <DrawerDescription>
              Submitted by {workerLabel} <RelativeTime value={submission.submittedAt} />
            </DrawerDescription>
          </DrawerHeader>
          <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-2">
            <p className="min-w-0 truncate text-sm font-medium text-foreground">
              {contextLabel ?? 'Submission gallery'}
            </p>
            <Button
              aria-label="Close submission gallery"
              onClick={() => handleOpenChange(false)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X aria-hidden="true" />
            </Button>
          </div>
          {artifactFilterControls}
          <div className="grid min-h-0 flex-1 overflow-hidden p-2">{playfield}</div>
          <div
            className="flex shrink-0 items-start justify-between gap-2 border-t border-border/58 px-4 py-2"
            data-testid="gallery-mobile-footer"
          >
            {detailsSection}
            {interactiveHtml ? <UntrustedHtmlWarningChip /> : null}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        aria-label="Submission gallery"
        className={cn(
          'max-h-[92vh] max-w-6xl gap-3 overflow-auto',
          fullViewport &&
            '!left-0 !top-0 h-app-viewport !w-screen !max-h-none !max-w-none !translate-x-0 !translate-y-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-none border-0'
        )}
        data-full-viewport={fullViewport ? 'true' : 'false'}
        onKeyDown={handleKeyDown}
        onEscapeKeyDown={(event) => {
          if (fullViewport) {
            event.preventDefault();
            setFullViewport(false);
          }
        }}
      >
        {liveRegion}
        <div className="grid gap-2">
          <DialogHeader className="grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 pr-9">
            <div className="grid min-w-0 gap-1.5">
              {contextLabel ? (
                <p className="text-sm font-medium text-foreground">{contextLabel}</p>
              ) : null}
              <DialogTitle className="break-all font-mono">{artifact.fileName}</DialogTitle>
              <DialogDescription>
                Submitted by{' '}
                <ActorLink
                  address={submission.workerAddress}
                  agentId={submission.workerAgentId}
                  className="font-mono text-foreground underline underline-offset-4 hover:text-primary"
                  label={workerLabel}
                  profileBasePath={profileBasePath}
                  title={submission.workerAddress}
                />{' '}
                <RelativeTime value={submission.submittedAt} />
              </DialogDescription>
            </div>
            <Button
              aria-label={fullViewport ? 'Exit full screen' : 'Enter full screen'}
              className="shrink-0"
              onClick={() => setFullViewport((value) => !value)}
              size="sm"
              type="button"
              variant="outline"
            >
              {fullViewport ? (
                <Minimize2 aria-hidden="true" className="size-4" />
              ) : (
                <Maximize2 aria-hidden="true" className="size-4" />
              )}
              <span>{fullViewport ? 'Exit full screen' : 'Enter full screen'}</span>
            </Button>
          </DialogHeader>
          {artifactFilterControls}
        </div>
        {playfield}
        {detailsSection}
      </DialogContent>
    </Dialog>
  );
}

type GallerySlideProps = {
  entry: SubmissionMediaEntry;
  motionDisabled: boolean;
  offset: SlideOffset;
  onCurrentPreviewChange: (artifactId: string, previewUrl: string | null) => void;
  onCurrentVideoAspectChange: (artifactId: string, ratio: number) => void;
  onPreviewEscape?: () => void;
  open: boolean;
  showWarning: boolean;
  taskId: string;
};

// One mounted pane of the windowed carousel. Each slide owns its own artifact's
// preview-URL lifecycle independently rather than lifting it to the parent. The
// parent still only ever hands out 3 slots (see gallerySlots), while interactive HTML
// content is mounted only in the current slot to enforce a single active document.
function GallerySlide({
  entry,
  motionDisabled,
  offset,
  onCurrentPreviewChange,
  onCurrentVideoAspectChange,
  onPreviewEscape,
  open,
  showWarning,
  taskId,
}: GallerySlideProps) {
  const { artifact } = entry;
  const isCurrent = offset === 0;
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if ((!open || !isCurrent) && video && !video.paused) {
      video.pause();
    } else if (open && isCurrent && video && video.videoHeight > 0 && video.videoWidth > 0) {
      onCurrentVideoAspectChange(artifact.id, video.videoWidth / video.videoHeight);
    }

    return () => {
      const currentVideo = videoRef.current;
      if (currentVideo && !currentVideo.paused) {
        currentVideo.pause();
      }
    };
  }, [artifact.id, isCurrent, onCurrentVideoAspectChange, open]);

  const handleVideoPreviewChange = useCallback(
    (previewUrl: string | null) => {
      if (isCurrent) {
        onCurrentPreviewChange(artifact.id, previewUrl);
      }
    },
    [artifact.id, isCurrent, onCurrentPreviewChange]
  );
  const handleVideoMetadata = useCallback(
    (event: SyntheticEvent<HTMLVideoElement>) => {
      const { videoHeight, videoWidth } = event.currentTarget;
      if (isCurrent && videoHeight > 0 && videoWidth > 0) {
        onCurrentVideoAspectChange(artifact.id, videoWidth / videoHeight);
      }
    },
    [artifact.id, isCurrent, onCurrentVideoAspectChange]
  );

  const content =
    artifact.mediaKind === 'video' ? (
      <ResilientArtifactVideo
        artifact={artifact}
        className="max-h-full max-w-full"
        controls
        fetchMissingPreview={isCurrent}
        onLoadedMetadata={handleVideoMetadata}
        onPreviewUrlChange={handleVideoPreviewChange}
        playbackActive={open && isCurrent}
        ref={videoRef}
      />
    ) : (
      <GalleryNonVideoPreview
        artifact={artifact}
        isCurrent={isCurrent}
        onCurrentPreviewChange={onCurrentPreviewChange}
        onPreviewEscape={isCurrent ? onPreviewEscape : undefined}
        open={open}
        showWarning={showWarning}
        taskId={taskId}
      />
    );

  const pane = (
    <div
      aria-hidden={isCurrent ? undefined : true}
      className={cn('grid h-full w-full place-items-center', !isCurrent && 'pointer-events-none')}
      data-gallery-current={isCurrent ? 'true' : undefined}
      inert={isCurrent ? undefined : true}
    >
      {content}
    </div>
  );

  if (motionDisabled) {
    return (
      <div
        className={cn(
          'absolute inset-0 h-full w-full',
          offset === -1 && '-translate-x-full',
          offset === 0 && 'translate-x-0',
          offset === 1 && 'translate-x-full'
        )}
      >
        {pane}
      </div>
    );
  }

  const targetX = `${offset * 100}%`;

  return (
    <motion.div
      animate={{ x: targetX }}
      className="absolute inset-0 h-full w-full"
      initial={{ x: targetX }}
      transition={{ duration: 0.32, ease: easeOut }}
    >
      {pane}
    </motion.div>
  );
}

type GalleryNonVideoPreviewProps = {
  artifact: ArtifactResponse;
  isCurrent: boolean;
  onCurrentPreviewChange: (artifactId: string, previewUrl: string | null) => void;
  onPreviewEscape?: () => void;
  open: boolean;
  showWarning: boolean;
  taskId: string;
};

function GalleryNonVideoPreview({
  artifact,
  isCurrent,
  onCurrentPreviewChange,
  onPreviewEscape,
  open,
  showWarning,
  taskId,
}: GalleryNonVideoPreviewProps) {
  const { ensurePreviewUrl, error, loading, previewUrl } = useArtifactPreviewUrl(taskId, artifact);

  useEffect(() => {
    if (!open || previewUrl || loading || error) {
      return;
    }

    void ensurePreviewUrl();
  }, [ensurePreviewUrl, error, loading, open, previewUrl]);

  useEffect(() => {
    if (!isCurrent) {
      return;
    }

    onCurrentPreviewChange(artifact.id, previewUrl);
  }, [artifact.id, isCurrent, onCurrentPreviewChange, previewUrl]);

  const content = error ? (
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
  ) : isInteractiveHtmlArtifact(artifact) && open && isCurrent ? (
    <InteractiveHtmlPreview
      artifact={artifact}
      classNames={showWarning ? GALLERY_HTML_CLASS_NAMES : GALLERY_HTML_CLASS_NAMES_COMPACT}
      onEscape={onPreviewEscape}
      onRetry={() => ensurePreviewUrl(true)}
      previewUrl={previewUrl}
      showWarning={showWarning}
    />
  ) : artifact.mediaKind === 'image' ? (
    <img
      alt={artifact.fileName}
      className="min-h-0 h-full w-full object-contain"
      src={previewUrl}
    />
  ) : null;

  return content;
}

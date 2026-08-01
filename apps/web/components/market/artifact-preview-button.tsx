'use client';

import type { ArtifactResponse } from '@taskmarket/shared';
import {
  ChevronDown,
  FileArchive,
  FileIcon,
  FileText,
  ImageIcon,
  Play,
  VideoIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Markdown from 'react-markdown';

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
import { ArtifactPoster } from '@/components/market/artifact-poster';
import {
  InteractiveHtmlPreview,
  UntrustedHtmlWarningChip,
} from '@/components/market/interactive-html-preview';
import { ResilientArtifactVideo } from '@/components/market/resilient-artifact-video';
import {
  useArtifactPreviewUrl,
  useStableArtifactPreviewUrl,
} from '@/components/market/use-artifact-preview-url';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { isInteractiveHtmlArtifact } from '@/lib/sandboxed-html';

type Props = {
  artifact: ArtifactResponse;
  taskId: string;
};

type PreviewTriggerState = {
  error: string | null;
  loading: boolean;
  openPreview: () => void;
};

type ArtifactPreviewTriggerProps = Props & {
  children: (state: PreviewTriggerState) => ReactNode;
  initialPreviewExpiresAt?: string | null;
  initialPreviewUrl?: string | null;
};

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const formatted =
    Number.isInteger(size) || size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1);
  return `${formatted} ${units[unitIndex] ?? 'B'}`;
}

function ArtifactKindIcon({ artifact }: { artifact: ArtifactResponse }) {
  if (artifact.mediaKind === 'image') {
    return <ImageIcon className="size-4" />;
  }
  if (artifact.mediaKind === 'video') {
    return <VideoIcon className="size-4" />;
  }
  if (artifact.mediaKind === 'text' || artifact.mediaKind === 'pdf') {
    return <FileText className="size-4" />;
  }
  if (artifact.mediaKind === 'archive') {
    return <FileArchive className="size-4" />;
  }
  return <FileIcon className="size-4" />;
}

// Meaningful, kind-based label for an artifact ArtifactPoster cannot render a live
// preview for (image/video already have their own inline preview, so this only ever
// fires for pdf/audio/archive/unknown, or a too-large HTML file). Leads with what the
// file *is* rather than its raw mimetype string.
function artifactKindLabel(artifact: ArtifactResponse): string {
  switch (artifact.mediaKind) {
    case 'pdf':
      return 'PDF document';
    case 'archive':
      return 'Archive';
    case 'audio':
      return 'Audio file';
    case 'text':
      return artifact.fileName.toLowerCase().endsWith('.md') ||
        artifact.mimeType === 'text/markdown'
        ? 'Markdown file'
        : 'Text file';
    default:
      return 'File';
  }
}

function MediaPreviewFallback({ artifact }: { artifact: ArtifactResponse }) {
  return (
    <div className="grid h-full min-h-24 place-items-center gap-2 bg-muted/32 p-3 text-center text-sm text-muted-foreground">
      <span className="grid size-9 place-items-center rounded-full border border-border/64 bg-background/60 text-foreground">
        <ArtifactKindIcon artifact={artifact} />
      </span>
      <span className="font-medium text-foreground">{artifactKindLabel(artifact)}</span>
    </div>
  );
}

export function ArtifactMetadata({
  artifact,
  previewUrl,
}: {
  artifact: ArtifactResponse;
  previewUrl: string | null;
}) {
  return (
    <dl className="grid gap-2 rounded-xl border border-border/60 bg-background/52 p-3 text-xs sm:grid-cols-2">
      <div>
        <dt className="font-mono uppercase text-muted-foreground">Type</dt>
        <dd className="mt-1 break-all font-mono text-foreground">{artifact.mimeType}</dd>
      </div>
      <div>
        <dt className="font-mono uppercase text-muted-foreground">Size</dt>
        <dd className="mt-1 font-mono text-foreground">{formatBytes(artifact.sizeBytes)}</dd>
      </div>
      <div>
        <dt className="font-mono uppercase text-muted-foreground">Role</dt>
        <dd className="mt-1 font-mono text-foreground">{artifact.role}</dd>
      </div>
      <div>
        <dt className="font-mono uppercase text-muted-foreground">Media</dt>
        <dd className="mt-1 font-mono text-foreground">{artifact.mediaKind}</dd>
      </div>
      {previewUrl ? (
        <div className="sm:col-span-2">
          <Button asChild size="sm" variant="outline">
            <a href={previewUrl} rel="noreferrer" target="_blank">
              Open artifact
            </a>
          </Button>
        </div>
      ) : null}
      <details className="sm:col-span-2">
        <summary className="cursor-pointer select-none font-mono uppercase text-muted-foreground hover:text-foreground">
          Technical details
        </summary>
        <dl className="mt-2 grid gap-2">
          <div>
            <dt className="font-mono uppercase text-muted-foreground">SHA-256</dt>
            <dd className="mt-1 break-all font-mono text-foreground">{artifact.sha256Hash}</dd>
          </div>
          <div>
            <dt className="font-mono uppercase text-muted-foreground">Keccak-256</dt>
            <dd className="mt-1 break-all font-mono text-foreground">{artifact.keccak256Hash}</dd>
          </div>
        </dl>
      </details>
    </dl>
  );
}

function TextPreview({
  artifact,
  previewUrl,
}: {
  artifact: ArtifactResponse;
  previewUrl: string | null;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState(false);
  const isMarkdown =
    artifact.fileName.toLowerCase().endsWith('.md') || artifact.mimeType === 'text/markdown';

  useEffect(() => {
    if (!previewUrl) return;
    fetch(previewUrl)
      .then((r) => r.text())
      .then(setContent)
      .catch(() => setFetchError(true));
  }, [previewUrl]);

  if (!previewUrl || content === null) {
    return (
      <div className="rounded-xl border border-border/60 bg-background/52 p-4 text-sm text-muted-foreground">
        {fetchError ? 'Failed to load preview.' : 'Loading...'}
      </div>
    );
  }

  if (isMarkdown) {
    return (
      <div className="markdown-preview max-h-[65vh] overflow-auto rounded-xl border border-border/60 bg-background/52 p-4 text-sm text-foreground">
        <Markdown>{content}</Markdown>
      </div>
    );
  }

  return (
    <pre className="max-h-[65vh] overflow-auto rounded-xl border border-border/60 bg-background/52 p-4 font-mono text-xs leading-5 text-foreground">
      {content}
    </pre>
  );
}

function ArtifactPreviewContent({
  artifact,
  fill = false,
  previewExpiresAt,
  previewUrl,
  showHtmlWarning = true,
}: {
  artifact: ArtifactResponse;
  fill?: boolean;
  previewExpiresAt: string | null;
  previewUrl: string | null;
  showHtmlWarning?: boolean;
}) {
  if (artifact.mediaKind === 'video') {
    return (
      <ResilientArtifactVideo
        artifact={artifact}
        className={cn(
          'w-full rounded-xl border border-border/60 bg-background/52',
          fill ? 'h-full' : 'max-h-[65vh]'
        )}
        controls
        initialPreviewExpiresAt={previewExpiresAt}
        initialPreviewUrl={previewUrl}
      />
    );
  }

  if (!previewUrl) {
    return (
      <div className="rounded-xl border border-border/60 bg-background/52 p-4 text-sm text-muted-foreground">
        Loading artifact preview...
      </div>
    );
  }

  if (isInteractiveHtmlArtifact(artifact)) {
    return (
      <InteractiveHtmlPreview
        artifact={artifact}
        classNames={
          fill
            ? {
                container: 'grid h-full grid-rows-[auto_1fr] gap-3',
                iframe: 'h-full w-full rounded-xl border border-border/60 bg-background/52',
              }
            : undefined
        }
        previewUrl={previewUrl}
        showWarning={showHtmlWarning}
      />
    );
  }

  if (artifact.mediaKind === 'image') {
    return (
      <div className="overflow-hidden rounded-xl border border-border/60 bg-background/52">
        <img
          alt={artifact.fileName}
          className={cn('w-full object-contain', fill ? 'h-full' : 'max-h-[65vh]')}
          src={previewUrl}
        />
      </div>
    );
  }

  if (artifact.mediaKind === 'pdf') {
    return (
      <iframe
        className={cn(
          'w-full rounded-xl border border-border/60 bg-background/52',
          fill ? 'h-full' : 'h-[65vh]'
        )}
        src={previewUrl}
        title={artifact.fileName}
      />
    );
  }

  if (artifact.mediaKind === 'audio') {
    return (
      <div className="rounded-xl border border-border/60 bg-background/52 p-4">
        <audio className="w-full" controls src={previewUrl}>
          <a href={previewUrl} rel="noreferrer" target="_blank">
            Open artifact
          </a>
        </audio>
      </div>
    );
  }

  if (artifact.mediaKind === 'text') {
    return <TextPreview artifact={artifact} previewUrl={previewUrl} />;
  }

  return (
    <div className="rounded-xl border border-border/60 bg-background/52 p-4 text-sm text-muted-foreground">
      This artifact type cannot be embedded inline.
    </div>
  );
}

type ArtifactPreviewSurfaceProps = {
  artifact: ArtifactResponse;
  ensurePreviewUrl: (force?: boolean) => Promise<string | null>;
  error: string | null;
  interactiveHtml: boolean;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  previewExpiresAt: string | null;
  previewUrl: string | null;
};

function DesktopArtifactDialog({
  artifact,
  ensurePreviewUrl,
  error,
  interactiveHtml,
  loading,
  onOpenChange,
  open,
  previewExpiresAt,
  previewUrl,
}: ArtifactPreviewSurfaceProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-auto">
        <DialogHeader>
          <DialogTitle className="break-all font-mono">{artifact.fileName}</DialogTitle>
          <DialogDescription>
            {artifact.mimeType} / {formatBytes(artifact.sizeBytes)}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="grid gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
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
        ) : (
          <ArtifactPreviewContent
            artifact={artifact}
            previewExpiresAt={previewExpiresAt}
            previewUrl={previewUrl}
          />
        )}

        <ArtifactMetadata artifact={artifact} previewUrl={interactiveHtml ? null : previewUrl} />
      </DialogContent>
    </Dialog>
  );
}

// The bottom sheet used below the md breakpoint. The measured problem was that the
// centered dialog spent ~200px of a phone-sized viewport on chrome (filename,
// mimetype/size line, a three-line security warning) before any of the actual
// content -- a game or other interactive artifact -- was visible. This surface
// gives the content the screen: a single compact header line, the warning
// collapsed into a tappable chip, and artifact metadata behind a footer disclosure
// that is not even mounted until opened, so the body never has to scroll while the
// content is on screen.
function MobileArtifactSheet({
  artifact,
  ensurePreviewUrl,
  error,
  interactiveHtml,
  loading,
  onOpenChange,
  open,
  previewExpiresAt,
  previewUrl,
}: ArtifactPreviewSurfaceProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const descriptionId = 'mobile-artifact-preview-description';

  return (
    <Drawer onOpenChange={onOpenChange} open={open}>
      {/* The variant prefix is repeated deliberately: components/ui/drawer.tsx caps
          bottom drawers with `data-[vaul-drawer-direction=bottom]:max-h-[80dvh]`, a
          class+attribute selector that outranks a plain `max-h-[*]` on specificity.
          Matching the prefix keeps specificity equal so tailwind-merge can drop the
          default and let this height win. */}
      <DrawerContent
        aria-describedby={descriptionId}
        className="data-[vaul-drawer-direction=bottom]:h-[92dvh] data-[vaul-drawer-direction=bottom]:max-h-[92dvh]"
      >
        <DrawerHeader className="sr-only">
          <DrawerTitle>{artifact.fileName}</DrawerTitle>
          <DrawerDescription id={descriptionId}>
            {artifact.mimeType} / {formatBytes(artifact.sizeBytes)}
          </DrawerDescription>
        </DrawerHeader>

        <div
          className="flex items-center justify-between gap-2 border-b border-border/58 px-4 pb-3"
          data-testid="mobile-artifact-preview-topbar"
        >
          <span className="text-sm font-medium text-foreground">Preview</span>
          {interactiveHtml ? <UntrustedHtmlWarningChip /> : null}
        </div>

        <div className="grid min-h-0 flex-1 overflow-hidden p-3">
          {error ? (
            <div className="grid gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
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
          ) : (
            <ArtifactPreviewContent
              artifact={artifact}
              fill
              previewExpiresAt={previewExpiresAt}
              previewUrl={previewUrl}
              showHtmlWarning={false}
            />
          )}
        </div>

        <div className="shrink-0 border-t border-border/58 px-4 py-2">
          <button
            aria-expanded={detailsOpen}
            className="flex w-full items-center justify-between font-mono text-xs uppercase text-muted-foreground hover:text-foreground"
            onClick={() => setDetailsOpen((value) => !value)}
            type="button"
          >
            Details
            <ChevronDown
              aria-hidden="true"
              className={cn('size-4 transition-transform', detailsOpen && 'rotate-180')}
            />
          </button>
          {detailsOpen ? (
            <div className="mt-2 max-h-[40vh] overflow-y-auto">
              <ArtifactMetadata
                artifact={artifact}
                previewUrl={interactiveHtml ? null : previewUrl}
              />
            </div>
          ) : null}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

export function ArtifactPreviewTrigger({
  artifact,
  children,
  initialPreviewExpiresAt,
  initialPreviewUrl,
  taskId,
}: ArtifactPreviewTriggerProps) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const interactiveHtml = isInteractiveHtmlArtifact(artifact);
  const { ensurePreviewUrl, error, loading, previewExpiresAt, previewUrl } = useArtifactPreviewUrl(
    taskId,
    artifact,
    {
      expiresAt: initialPreviewExpiresAt,
      url: initialPreviewUrl,
    }
  );
  const Surface = isMobile ? MobileArtifactSheet : DesktopArtifactDialog;

  return (
    <>
      {children({
        error,
        loading,
        openPreview: () => {
          if (previewUrl) {
            setOpen(true);
            return;
          }

          void ensurePreviewUrl().finally(() => setOpen(true));
        },
      })}
      <Surface
        artifact={artifact}
        ensurePreviewUrl={ensurePreviewUrl}
        error={error}
        interactiveHtml={interactiveHtml}
        loading={loading}
        onOpenChange={setOpen}
        open={open}
        previewExpiresAt={previewExpiresAt}
        previewUrl={previewUrl}
      />
    </>
  );
}

export function ArtifactMediaTile({ artifact, taskId }: Props) {
  const stablePreviewUrl = useStableArtifactPreviewUrl(artifact);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(stablePreviewUrl);
  const previewUrl = artifact.mediaKind === 'video' ? videoPreviewUrl : stablePreviewUrl;
  const openLabel = `Open ${artifact.fileName} preview`;

  useEffect(() => {
    setVideoPreviewUrl(stablePreviewUrl);
  }, [artifact.id, stablePreviewUrl]);

  return (
    <ArtifactPreviewTrigger
      artifact={artifact}
      initialPreviewExpiresAt={artifact.mediaKind === 'video' ? null : artifact.previewExpiresAt}
      initialPreviewUrl={previewUrl}
      taskId={taskId}
    >
      {({ error, loading, openPreview }) => (
        <div className="grid min-w-0 overflow-hidden rounded-lg border border-border/58 bg-background/42 shadow-[var(--shadow-soft)]">
          <div className="aspect-video bg-muted/26">
            {artifact.mediaKind === 'image' && previewUrl ? (
              <button
                aria-label={openLabel}
                className="block h-full w-full cursor-zoom-in overflow-hidden"
                onClick={openPreview}
                type="button"
              >
                <img
                  alt={artifact.fileName}
                  className="h-full w-full object-contain"
                  loading="lazy"
                  src={previewUrl}
                />
              </button>
            ) : artifact.mediaKind === 'video' ? (
              <ResilientArtifactVideo
                artifact={artifact}
                className="h-full w-full object-contain"
                controls
                muted
                onPreviewUrlChange={setVideoPreviewUrl}
                preload="metadata"
              />
            ) : (
              <button
                aria-label={openLabel}
                className="h-full w-full cursor-pointer"
                onClick={openPreview}
                type="button"
              >
                <ArtifactPoster
                  artifact={artifact}
                  fallback={<MediaPreviewFallback artifact={artifact} />}
                  previewUrl={previewUrl}
                />
              </button>
            )}
          </div>
          <div className="grid gap-2 border-t border-border/52 p-3">
            <div className="grid min-w-0 gap-2">
              <div className="grid min-w-0 gap-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-muted-foreground">
                    <ArtifactKindIcon artifact={artifact} />
                  </span>
                  <span className="min-w-0 truncate font-mono text-sm" title={artifact.fileName}>
                    {artifact.fileName}
                  </span>
                </div>
                <span className="font-mono text-xs text-muted-foreground">
                  {artifact.mimeType} / {formatBytes(artifact.sizeBytes)}
                </span>
              </div>
              {artifact.mediaKind === 'video' && previewUrl ? (
                <Button
                  aria-label={openLabel}
                  className="w-fit"
                  disabled={loading}
                  onClick={openPreview}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Play className="size-3" />
                  {loading ? 'Loading...' : 'Open'}
                </Button>
              ) : null}
            </div>
            {error ? <span className="text-xs text-destructive">{error}</span> : null}
          </div>
        </div>
      )}
    </ArtifactPreviewTrigger>
  );
}

// Full-width image-first surface for a submission's primary deliverable. The media
// is the whole element: no filename/size caption, and a click opens the viewer
// (the shared gallery when onOpen is provided, the per-artifact dialog otherwise).
function MediaHeroVideoFallback({ onVisible }: { onVisible: () => void }) {
  useEffect(() => {
    onVisible();
  }, [onVisible]);

  return <p>This video cannot be played in your browser.</p>;
}

function MediaHeroSurface({
  artifact,
  onOpen,
  onVideoPreviewUrlChange,
  previewUrl,
}: {
  artifact: ArtifactResponse;
  onOpen: () => void;
  onVideoPreviewUrlChange: (previewUrl: string | null) => void;
  previewUrl: string | null;
}) {
  const openLabel = `Open ${artifact.fileName} preview`;
  const [videoFailed, setVideoFailed] = useState(false);
  const handleVideoFallbackVisible = useCallback(() => setVideoFailed(true), []);

  useEffect(() => {
    setVideoFailed(false);
  }, [artifact.id]);

  return (
    <div className="overflow-hidden rounded-lg border border-border/58 bg-muted/26 shadow-[var(--shadow-soft)]">
      <div className="aspect-video">
        {artifact.mediaKind === 'image' && previewUrl ? (
          <button
            aria-label={openLabel}
            className="block h-full w-full cursor-zoom-in overflow-hidden"
            onClick={onOpen}
            type="button"
          >
            <img
              alt={artifact.fileName}
              className="h-full w-full object-contain"
              loading="lazy"
              src={previewUrl}
            />
          </button>
        ) : artifact.mediaKind === 'video' ? (
          <div className="relative h-full w-full overflow-hidden">
            <ResilientArtifactVideo
              artifact={artifact}
              className="h-full w-full object-contain"
              fallback={<MediaHeroVideoFallback onVisible={handleVideoFallbackVisible} />}
              muted
              onPreviewUrlChange={onVideoPreviewUrlChange}
              preload="metadata"
            />
            {!videoFailed ? (
              <button
                aria-label={openLabel}
                className="absolute inset-0 grid h-full w-full cursor-zoom-in place-items-center"
                onClick={onOpen}
                type="button"
              >
                <span className="grid size-11 place-items-center rounded-full border border-border/64 bg-background/72 text-foreground">
                  <Play className="size-4" />
                </span>
              </button>
            ) : null}
          </div>
        ) : (
          <button
            aria-label={openLabel}
            className="h-full w-full cursor-pointer"
            onClick={onOpen}
            type="button"
          >
            <ArtifactPoster
              artifact={artifact}
              fallback={<MediaPreviewFallback artifact={artifact} />}
              previewUrl={previewUrl}
            />
          </button>
        )}
      </div>
    </div>
  );
}

export function ArtifactMediaHero({ artifact, onOpen, taskId }: Props & { onOpen?: () => void }) {
  const stablePreviewUrl = useStableArtifactPreviewUrl(artifact);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(stablePreviewUrl);
  const previewUrl = artifact.mediaKind === 'video' ? videoPreviewUrl : stablePreviewUrl;

  useEffect(() => {
    setVideoPreviewUrl(stablePreviewUrl);
  }, [artifact.id, stablePreviewUrl]);

  if (onOpen) {
    return (
      <MediaHeroSurface
        artifact={artifact}
        onOpen={onOpen}
        onVideoPreviewUrlChange={setVideoPreviewUrl}
        previewUrl={previewUrl}
      />
    );
  }

  return (
    <ArtifactPreviewTrigger
      artifact={artifact}
      initialPreviewExpiresAt={artifact.mediaKind === 'video' ? null : artifact.previewExpiresAt}
      initialPreviewUrl={previewUrl}
      taskId={taskId}
    >
      {({ error, openPreview }) => (
        <div className="grid gap-1">
          <MediaHeroSurface
            artifact={artifact}
            onOpen={openPreview}
            onVideoPreviewUrlChange={setVideoPreviewUrl}
            previewUrl={previewUrl}
          />
          {error ? <span className="text-xs text-destructive">{error}</span> : null}
        </div>
      )}
    </ArtifactPreviewTrigger>
  );
}

// Small square thumbnail for a submission's secondary media artifacts.
function MediaThumbSurface({
  artifact,
  onOpen,
  previewUrl,
}: {
  artifact: ArtifactResponse;
  onOpen: () => void;
  previewUrl: string | null;
}) {
  return (
    <button
      aria-label={`Open ${artifact.fileName} preview`}
      className="relative size-16 shrink-0 cursor-zoom-in overflow-hidden rounded-md border border-border/58 bg-muted/26"
      onClick={onOpen}
      title={artifact.fileName}
      type="button"
    >
      {artifact.mediaKind === 'image' && previewUrl ? (
        <img
          alt={artifact.fileName}
          className="h-full w-full object-cover"
          loading="lazy"
          src={previewUrl}
        />
      ) : (
        <span className="grid h-full w-full place-items-center text-muted-foreground">
          <ArtifactKindIcon artifact={artifact} />
        </span>
      )}
      {artifact.mediaKind === 'video' ? (
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid size-6 place-items-center rounded-full border border-border/64 bg-background/72 text-foreground">
            <Play className="size-3" />
          </span>
        </span>
      ) : null}
    </button>
  );
}

export function ArtifactMediaThumb({ artifact, onOpen, taskId }: Props & { onOpen?: () => void }) {
  const previewUrl = useStableArtifactPreviewUrl(artifact);

  if (onOpen) {
    return <MediaThumbSurface artifact={artifact} onOpen={onOpen} previewUrl={previewUrl} />;
  }

  return (
    <ArtifactPreviewTrigger
      artifact={artifact}
      initialPreviewExpiresAt={artifact.previewExpiresAt ?? null}
      initialPreviewUrl={artifact.previewUrl ?? null}
      taskId={taskId}
    >
      {({ openPreview }) => (
        <MediaThumbSurface artifact={artifact} onOpen={openPreview} previewUrl={previewUrl} />
      )}
    </ArtifactPreviewTrigger>
  );
}

export function ArtifactPreviewButton({
  artifact,
  label = 'View',
  taskId,
}: Props & { label?: ReactNode }) {
  return (
    <ArtifactPreviewTrigger artifact={artifact} taskId={taskId}>
      {({ error, loading, openPreview }) => (
        <div className="flex items-center gap-2">
          <Button disabled={loading} onClick={openPreview} size="sm" type="button" variant="ghost">
            {loading ? 'Loading...' : label}
          </Button>
          {error ? <span className="text-xs text-destructive">{error}</span> : null}
        </div>
      )}
    </ArtifactPreviewTrigger>
  );
}

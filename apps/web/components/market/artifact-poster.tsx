'use client';

import type { ArtifactResponse } from '@taskmarket/shared';
import { Play } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

import { InteractiveHtmlPreview } from '@/components/market/interactive-html-preview';
import { taskCoverPlaceholderStyle } from '@/lib/market/task-cover';
import { canRenderInteractiveHtml, isInteractiveHtmlArtifact } from '@/lib/sandboxed-html';
import { cn } from '@/lib/utils';

// A live, non-interactive preview of an artifact's real content, for any surface that
// would otherwise stand in a generic icon + mimetype placeholder for a file it hasn't
// rendered -- "a preview of the thing IS the thumbnail". Two content kinds render a
// poster today:
//
//   - Interactive HTML: the sandboxed document itself, scaled to fill the tile,
//     `pointer-events-none` so the tile stays a single click target.
//   - Text/markdown: the artifact's own `textPreview` snippet, rendered as real type
//     over the deterministic per-task gradient (see lib/market/task-cover.ts).
//
// Everything else -- image, video, pdf, audio, archive, or an HTML file too large to
// sandbox inline -- falls back to the caller-supplied `fallback` node (see
// MediaPreviewFallback in artifact-preview-button.tsx). Designed as a standalone
// module so a later feed-cover surface can consume it directly, independent of the
// submission-review call sites in tasks.tsx / artifact-preview-button.tsx.
export type ArtifactPosterProps = {
  artifact: ArtifactResponse;
  className?: string;
  fallback: ReactNode;
  previewUrl: string | null;
};

// Whether ArtifactPoster has real content to show for this artifact/URL pair, so a
// caller can decide layout (e.g. whether an artifact is "hero-worthy") without
// duplicating the HTML/text detection rules below.
export function canRenderArtifactPoster(
  artifact: Pick<
    ArtifactResponse,
    'fileName' | 'mediaKind' | 'mimeType' | 'sizeBytes' | 'textPreview'
  >,
  previewUrl: string | null
): boolean {
  if (isInteractiveHtmlArtifact(artifact)) {
    return Boolean(previewUrl) && canRenderInteractiveHtml(artifact);
  }
  return artifact.mediaKind === 'text' && Boolean(artifact.textPreview?.trim());
}

// Mounts `children` only once the wrapped element is observed near the viewport, so a
// feed holding many posters does not eagerly fetch and mount every live iframe at
// once. When IntersectionObserver is unavailable (older browsers, and this repo's
// jsdom test environment) this fails closed: the element is treated as never near the
// viewport, so the caller's static fallback stays on screen instead of firing an
// unbounded number of network requests the moment the observer is missing.
function useNearViewport<T extends HTMLElement>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [nearViewport, setNearViewport] = useState(false);

  useEffect(() => {
    if (nearViewport) {
      return;
    }
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNearViewport(true);
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [nearViewport]);

  return [ref, nearViewport];
}

function HtmlPoster({ artifact, previewUrl }: { artifact: ArtifactResponse; previewUrl: string }) {
  return (
    <div className="relative h-full w-full overflow-hidden">
      <InteractiveHtmlPreview
        artifact={artifact}
        classNames={{
          container: 'h-full w-full',
          error:
            'grid h-full place-items-center bg-muted/24 p-3 text-center text-xs text-muted-foreground',
          iframe: 'h-full w-full border-0 pointer-events-none bg-background',
          message:
            'grid h-full place-items-center bg-muted/24 p-3 text-center text-xs text-muted-foreground',
        }}
        previewUrl={previewUrl}
        showWarning={false}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 grid place-items-center bg-gradient-to-t from-background/45 via-transparent to-transparent"
      >
        <span className="grid size-11 place-items-center rounded-full border border-border/64 bg-background/72 text-foreground">
          <Play className="size-4" />
        </span>
      </span>
    </div>
  );
}

function TextPoster({ artifact }: { artifact: ArtifactResponse }) {
  const lines = (artifact.textPreview ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6);

  return (
    <div
      className="grid h-full w-full content-start gap-1 overflow-hidden p-4 text-left font-mono text-xs leading-5 text-foreground"
      style={taskCoverPlaceholderStyle(artifact.taskId)}
    >
      {lines.map((line, index) => (
        <p className="truncate" key={index}>
          {line}
        </p>
      ))}
    </div>
  );
}

export function ArtifactPoster({ artifact, className, fallback, previewUrl }: ArtifactPosterProps) {
  const [ref, nearViewport] = useNearViewport<HTMLDivElement>();
  const htmlPosterUrl =
    isInteractiveHtmlArtifact(artifact) && previewUrl && canRenderInteractiveHtml(artifact)
      ? previewUrl
      : null;
  const textContent =
    artifact.mediaKind === 'text' && !htmlPosterUrl ? artifact.textPreview?.trim() : undefined;

  if (!htmlPosterUrl && !textContent) {
    return <>{fallback}</>;
  }

  return (
    <div className={cn('h-full w-full overflow-hidden', className)} ref={ref}>
      {htmlPosterUrl ? (
        nearViewport ? (
          <HtmlPoster artifact={artifact} previewUrl={htmlPosterUrl} />
        ) : (
          fallback
        )
      ) : (
        <TextPoster artifact={artifact} />
      )}
    </div>
  );
}

'use client';

import type { ArtifactResponse } from '@taskmarket/shared';
import { FileArchive, FileIcon, FileText, ImageIcon, Play, VideoIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import Markdown from 'react-markdown';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getBrowserApiBaseUrl } from '@/lib/api/config';

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

type PreviewState = {
  expiresAt: string | null;
  url: string | null;
};

function isPreviewUrlCurrent(expiresAt: string | null) {
  if (!expiresAt) {
    return true;
  }

  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return false;
  }

  return expiresAtMs > Date.now() + 30_000;
}

function currentPreviewUrl(preview: PreviewState) {
  if (!preview.url || !isPreviewUrlCurrent(preview.expiresAt)) {
    return null;
  }

  return preview.url;
}

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

function usableArtifactPreviewUrl(artifact: ArtifactResponse) {
  if (!artifact.previewUrl) {
    return null;
  }

  if (!artifact.previewExpiresAt) {
    return artifact.previewUrl;
  }

  const expiresAtMs = Date.parse(artifact.previewExpiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return null;
  }

  return expiresAtMs > Date.now() + 30_000 ? artifact.previewUrl : null;
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

function MediaPreviewFallback({ artifact }: { artifact: ArtifactResponse }) {
  return (
    <div className="grid h-full min-h-32 place-items-center gap-3 bg-muted/32 p-4 text-center text-sm text-muted-foreground">
      <div className="grid justify-items-center gap-2">
        <span className="grid size-11 place-items-center rounded-full border border-border/64 bg-background/60 text-foreground">
          <ArtifactKindIcon artifact={artifact} />
        </span>
        <span className="font-medium text-foreground">Open preview</span>
        <span className="max-w-48 break-words text-xs leading-5">{artifact.mimeType}</span>
      </div>
    </div>
  );
}

function ArtifactMetadata({
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
  previewUrl,
}: {
  artifact: ArtifactResponse;
  previewUrl: string | null;
}) {
  if (!previewUrl) {
    return (
      <div className="rounded-xl border border-border/60 bg-background/52 p-4 text-sm text-muted-foreground">
        Loading artifact preview...
      </div>
    );
  }

  if (artifact.mediaKind === 'image') {
    return (
      <div className="overflow-hidden rounded-xl border border-border/60 bg-background/52">
        <img
          alt={artifact.fileName}
          className="max-h-[65vh] w-full object-contain"
          src={previewUrl}
        />
      </div>
    );
  }

  if (artifact.mediaKind === 'pdf') {
    return (
      <iframe
        className="h-[65vh] w-full rounded-xl border border-border/60 bg-background/52"
        src={previewUrl}
        title={artifact.fileName}
      />
    );
  }

  if (artifact.mediaKind === 'video') {
    return (
      <video
        className="max-h-[65vh] w-full rounded-xl border border-border/60 bg-background/52"
        controls
        src={previewUrl}
      >
        <a href={previewUrl} rel="noreferrer" target="_blank">
          Open artifact
        </a>
      </video>
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

export function ArtifactPreviewTrigger({
  artifact,
  children,
  initialPreviewExpiresAt,
  initialPreviewUrl,
  taskId,
}: ArtifactPreviewTriggerProps) {
  const [open, setOpen] = useState(false);
  const providedPreviewUrl = initialPreviewUrl ?? artifact.previewUrl ?? null;
  const providedPreviewExpiresAt = initialPreviewExpiresAt ?? artifact.previewExpiresAt ?? null;
  const [preview, setPreview] = useState<PreviewState>({
    expiresAt: providedPreviewExpiresAt,
    url: providedPreviewUrl,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewUrl = currentPreviewUrl(preview);

  useEffect(() => {
    setPreview({
      expiresAt: providedPreviewExpiresAt,
      url: providedPreviewUrl,
    });
    setError(null);
  }, [artifact.id, providedPreviewExpiresAt, providedPreviewUrl]);

  async function loadPreview(force = false) {
    const existingPreviewUrl = currentPreviewUrl(preview);
    if (!force && existingPreviewUrl) {
      return existingPreviewUrl;
    }

    setLoading(true);
    setError(null);
    if (force) {
      setPreview({ expiresAt: null, url: null });
    }

    try {
      const base = getBrowserApiBaseUrl();
      const res = await fetch(
        `${base}/api/tasks/${taskId}/artifacts/${artifact.id}/preview?taskId=${taskId}&artifactId=${artifact.id}`
      );

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Request failed (${res.status})`);
      }

      const { expiresAt, previewUrl } = (await res.json()) as {
        expiresAt?: string;
        previewUrl: string;
      };
      setPreview({ expiresAt: expiresAt ?? null, url: previewUrl });
      return previewUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
      return null;
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {children({
        error,
        loading,
        openPreview: () => {
          if (currentPreviewUrl(preview)) {
            setOpen(true);
            return;
          }

          void loadPreview().finally(() => setOpen(true));
        },
      })}
      <Dialog open={open} onOpenChange={setOpen}>
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
                onClick={() => void loadPreview(true)}
                size="sm"
                type="button"
              >
                Retry
              </Button>
            </div>
          ) : (
            <ArtifactPreviewContent artifact={artifact} previewUrl={previewUrl} />
          )}

          <ArtifactMetadata artifact={artifact} previewUrl={previewUrl} />
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ArtifactMediaTile({ artifact, taskId }: Props) {
  const previewUrl = usableArtifactPreviewUrl(artifact);
  const openLabel = `Open ${artifact.fileName} preview`;

  return (
    <ArtifactPreviewTrigger
      artifact={artifact}
      initialPreviewExpiresAt={artifact.previewExpiresAt ?? null}
      initialPreviewUrl={artifact.previewUrl ?? null}
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
            ) : artifact.mediaKind === 'video' && previewUrl ? (
              <video
                className="h-full w-full object-contain"
                controls
                muted
                preload="metadata"
                src={previewUrl}
              />
            ) : (
              <button
                aria-label={openLabel}
                className="h-full w-full cursor-pointer"
                onClick={openPreview}
                type="button"
              >
                <MediaPreviewFallback artifact={artifact} />
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

export function ArtifactPreviewButton({ artifact, taskId }: Props) {
  return (
    <ArtifactPreviewTrigger artifact={artifact} taskId={taskId}>
      {({ error, loading, openPreview }) => (
        <div className="flex items-center gap-2">
          <Button disabled={loading} onClick={openPreview} size="sm" type="button" variant="ghost">
            {loading ? 'Loading...' : 'View'}
          </Button>
          {error ? <span className="text-xs text-destructive">{error}</span> : null}
        </div>
      )}
    </ArtifactPreviewTrigger>
  );
}

'use client';

import type { ArtifactResponse } from '@taskmarket/shared';
import { useState } from 'react';

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
    return artifact.textPreview ? (
      <pre className="max-h-[65vh] overflow-auto rounded-xl border border-border/60 bg-background/52 p-4 font-mono text-xs leading-5 text-foreground">
        {artifact.textPreview}
      </pre>
    ) : (
      <div className="rounded-xl border border-border/60 bg-background/52 p-4 text-sm text-muted-foreground">
        No text preview is available for this artifact.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/60 bg-background/52 p-4 text-sm text-muted-foreground">
      This artifact type cannot be embedded inline.
    </div>
  );
}

export function ArtifactPreviewButton({ artifact, taskId }: Props) {
  const [open, setOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePreview() {
    setOpen(true);
    setLoading(true);
    setError(null);
    setPreviewUrl(null);
    try {
      const base = getBrowserApiBaseUrl();
      const res = await fetch(
        `${base}/api/tasks/${taskId}/artifacts/${artifact.id}/preview?taskId=${taskId}&artifactId=${artifact.id}`
      );

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Request failed (${res.status})`);
      }

      const { previewUrl } = (await res.json()) as { previewUrl: string };
      setPreviewUrl(previewUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button disabled={loading} onClick={handlePreview} size="sm" type="button" variant="ghost">
        {loading ? 'Loading...' : 'View'}
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
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
              <Button disabled={loading} onClick={handlePreview} size="sm" type="button">
                Retry
              </Button>
            </div>
          ) : (
            <ArtifactPreviewContent artifact={artifact} previewUrl={previewUrl} />
          )}

          <ArtifactMetadata artifact={artifact} previewUrl={previewUrl} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

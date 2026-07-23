'use client';

import type { ArtifactResponse } from '@taskmarket/shared';
import { useCallback, useEffect, useState } from 'react';

import { getBrowserApiBaseUrl } from '@/lib/api/config';

type PreviewState = {
  expiresAt: string | null;
  url: string | null;
};

// A preview URL is only trusted while it still has a 30s validity margin, so media
// that starts loading right before expiry can still finish.
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

// The batch preview URL shipped on the artifact itself, if it is still current.
export function usableArtifactPreviewUrl(artifact: ArtifactResponse) {
  return currentPreviewUrl({
    expiresAt: artifact.previewExpiresAt ?? null,
    url: artifact.previewUrl ?? null,
  });
}

// Owns the lifecycle of a single artifact's presigned preview URL: seeds from the
// batch URL delivered with the artifact (or an explicit initial override), reports
// null once that URL expires, and fetches a fresh one on demand via ensurePreviewUrl.
export function useArtifactPreviewUrl(
  taskId: string,
  artifact: ArtifactResponse,
  initial?: { expiresAt?: string | null; url?: string | null }
) {
  const providedUrl = initial?.url ?? artifact.previewUrl ?? null;
  const providedExpiresAt = initial?.expiresAt ?? artifact.previewExpiresAt ?? null;
  const [preview, setPreview] = useState<PreviewState>({
    expiresAt: providedExpiresAt,
    url: providedUrl,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewUrl = currentPreviewUrl(preview);

  useEffect(() => {
    setPreview({
      expiresAt: providedExpiresAt,
      url: providedUrl,
    });
    setError(null);
  }, [artifact.id, providedExpiresAt, providedUrl]);

  const ensurePreviewUrl = useCallback(
    async (force = false) => {
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

        const { expiresAt, previewUrl: freshUrl } = (await res.json()) as {
          expiresAt?: string;
          previewUrl: string;
        };
        setPreview({ expiresAt: expiresAt ?? null, url: freshUrl });
        return freshUrl;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Preview failed');
        return null;
      } finally {
        setLoading(false);
      }
    },
    [artifact.id, preview, taskId]
  );

  return { ensurePreviewUrl, error, loading, previewUrl };
}

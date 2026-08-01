'use client';

import type { ArtifactResponse } from '@taskmarket/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getBrowserApiBaseUrl } from '@/lib/api/config';

type PreviewState = {
  expiresAt: string | null;
  url: string | null;
};

// Preview URLs are presigned per request, so the polled activity feed hands the same
// artifact a different (but equivalent) URL every few seconds. Feeding that into a
// media src makes the browser drop what it has loaded and restart from zero, which
// stops a video mid-playback. Every consumer therefore pins the first usable URL it
// sees for an artifact and keeps serving it until that URL actually expires.

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

// Render-time preview URL for media embedded straight off a polled list: the same
// value usableArtifactPreviewUrl returns, held stable for as long as it stays valid
// so a background refresh never swaps the src of a playing element.
export function useStableArtifactPreviewUrl(artifact: ArtifactResponse) {
  const pinned = useRef<{ artifactId: string; preview: PreviewState } | null>(null);
  const held = pinned.current;

  if (held?.artifactId === artifact.id) {
    const heldUrl = currentPreviewUrl(held.preview);
    if (heldUrl) {
      return heldUrl;
    }
  }

  const preview: PreviewState = {
    expiresAt: artifact.previewExpiresAt ?? null,
    url: artifact.previewUrl ?? null,
  };
  const freshUrl = currentPreviewUrl(preview);
  pinned.current = freshUrl ? { artifactId: artifact.id, preview } : null;

  return freshUrl;
}

// Owns the lifecycle of a single artifact's presigned preview URL: seeds from the
// batch URL delivered with the artifact (or an explicit initial override), reports
// null once that URL expires, and fetches a fresh one on demand via ensurePreviewUrl.
export function useArtifactPreviewUrl(
  taskId: string,
  artifact: ArtifactResponse,
  initial?: { expiresAt?: string | null; url?: string | null }
) {
  const hasInitial = initial !== undefined;
  const providedUrl = initial === undefined ? (artifact.previewUrl ?? null) : (initial.url ?? null);
  const providedExpiresAt =
    initial === undefined ? (artifact.previewExpiresAt ?? null) : (initial.expiresAt ?? null);
  const [preview, setPreview] = useState<PreviewState>({
    expiresAt: providedExpiresAt,
    url: providedUrl,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewUrl = currentPreviewUrl(preview);
  const seededArtifactId = useRef(artifact.id);

  useEffect(() => {
    const artifactChanged = seededArtifactId.current !== artifact.id;
    seededArtifactId.current = artifact.id;

    // Adopt a list URL only when nothing usable is held: a poll re-signing the same
    // artifact would otherwise restart playing media. An explicit initial override
    // comes from a renderer that already refreshed the URL, so it is authoritative.
    setPreview((current) => {
      const explicitInitialChanged = hasInitial && current.url !== providedUrl;
      return !artifactChanged && !explicitInitialChanged && currentPreviewUrl(current)
        ? current
        : { expiresAt: providedExpiresAt, url: providedUrl };
    });

    if (artifactChanged) {
      setError(null);
    }
  }, [artifact.id, hasInitial, providedExpiresAt, providedUrl]);

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

  return {
    ensurePreviewUrl,
    error,
    loading,
    previewExpiresAt: preview.expiresAt,
    previewUrl,
  };
}

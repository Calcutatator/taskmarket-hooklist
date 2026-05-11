'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { getBrowserApiBaseUrl } from '@/lib/api/config';

type Props = {
  artifactId: string;
  taskId: string;
};

export function ArtifactPreviewButton({ artifactId, taskId }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePreview() {
    setLoading(true);
    setError(null);
    try {
      const base = getBrowserApiBaseUrl();
      const res = await fetch(
        `${base}/api/tasks/${taskId}/artifacts/${artifactId}/preview?taskId=${taskId}&artifactId=${artifactId}`
      );

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Request failed (${res.status})`);
      }

      const { previewUrl } = (await res.json()) as { previewUrl: string };
      window.open(previewUrl, '_blank', 'noopener,noreferrer');
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
    </div>
  );
}

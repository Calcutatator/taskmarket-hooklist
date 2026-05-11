'use client';

import { useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';

import { Button } from '@/components/ui/button';
import { getBrowserApiBaseUrl } from '@/lib/api/config';

type Props = {
  artifactId: string;
  taskId: string;
};

export function ArtifactPreviewButton({ artifactId, taskId }: Props) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isConnected || !address) return null;

  async function handlePreview() {
    setLoading(true);
    setError(null);
    try {
      const message = `taskmarket:artifact-preview:${taskId}:${artifactId}`;
      const signature = await signMessageAsync({ message });

      const base = getBrowserApiBaseUrl();
      const res = await fetch(`${base}/api/tasks/${taskId}/artifacts/${artifactId}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, artifactId, viewerAddress: address, signature }),
      });

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
        {loading ? 'Signing...' : 'View'}
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}

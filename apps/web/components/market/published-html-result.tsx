'use client';

import type { ArtifactResponse } from '@taskmarket/shared';
import { Check, Code2, Copy, ExternalLink, Share2 } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { ArtifactPreviewTrigger } from '@/components/market/artifact-preview-button';
import { Button } from '@/components/ui/button';

export function PublishedHtmlResult({
  artifact,
  artifactCount,
  href,
  initiallyOpen = false,
  taskId,
  taskTitle,
}: {
  artifact: ArtifactResponse;
  artifactCount: number;
  href: string;
  initiallyOpen?: boolean;
  taskId: string;
  taskTitle: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [copied, setCopied] = useState(false);

  function absoluteHref() {
    return new URL(href, window.location.origin).toString();
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(absoluteHref());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Native sharing remains available when clipboard access is unavailable.
    }
  }

  async function shareLink() {
    const data = {
      text: 'View the interactive HTML result on Taskmarket.',
      title: taskTitle,
      url: absoluteHref(),
    };

    if (navigator.share) {
      try {
        await navigator.share(data);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
      }
    }

    await copyLink();
  }

  function handlePreviewOpenChange(open: boolean) {
    if (open || !initiallyOpen) {
      return;
    }

    const nextSearchParams = new URLSearchParams(searchParams.toString());
    nextSearchParams.delete('artifact');
    const query = nextSearchParams.toString();
    const nextHref = `${pathname}${query ? `?${query}` : ''}` as Route;
    router.replace(nextHref, { scroll: false });
  }

  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="grid min-w-0 gap-1">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Code2 aria-hidden="true" className="size-4 text-primary" />
          Interactive HTML result
        </div>
        <p
          className="min-w-0 truncate font-mono text-xs text-muted-foreground"
          title={artifact.fileName}
        >
          {artifact.fileName} ·{' '}
          {artifactCount === 1 ? 'HTML result' : `${artifactCount} HTML results`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant="outline">
          <Link href={href as Route}>
            Open interactive result
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </Link>
        </Button>
        <Button
          aria-label="Share interactive result"
          onClick={() => void shareLink()}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <Share2 aria-hidden="true" />
        </Button>
        <Button
          aria-label={copied ? 'Link copied' : 'Copy interactive result link'}
          onClick={() => void copyLink()}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </Button>
      </div>
      {initiallyOpen ? (
        <ArtifactPreviewTrigger
          artifact={artifact}
          autoOpen
          onPreviewOpenChange={handlePreviewOpenChange}
          taskId={taskId}
        >
          {() => null}
        </ArtifactPreviewTrigger>
      ) : null}
    </div>
  );
}

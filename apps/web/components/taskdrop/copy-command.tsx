'use client';

import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function CopyCommand({
  className,
  command,
}: Readonly<{ className?: string; command: string }>) {
  const [copied, setCopied] = useState(false);

  // Cleared on unmount: an uncleared reset timer fires against an unmounted tree, and in jsdom
  // that lands after the environment is gone, so React's state dispatch throws
  // `window is not defined` and vitest fails a run in which every test passed.
  const copiedTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    },
    []
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Button
      className={cn(
        'ml-auto inline-flex min-h-11 shrink-0 cursor-pointer items-center px-3 py-2 font-mono text-[11px] tracking-[0.06em] uppercase',
        className
      )}
      onClick={copy}
      type="button"
      variant="taskdrop-accent"
    >
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

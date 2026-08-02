'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function CopyCommand({
  className,
  command,
}: Readonly<{ className?: string; command: string }>) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
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

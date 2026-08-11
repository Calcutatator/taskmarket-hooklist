'use client';

import { CheckIcon, CopyIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

// icon takes an already-rendered element (e.g. <FileJsonIcon />), not a component
// reference -- this file is used from server components, and a bare component
// reference can't cross the server/client boundary as a prop (only serializable
// values and already-rendered elements can). Passing an element lets two copy
// buttons sitting side by side (e.g. "copy as JSON" vs "copy as markdown") stay
// visually distinct at a glance, not just via aria-label/tooltip text. The tooltip
// is a real hover affordance (not just aria-label, which only screen readers
// expose) so a sighted user can tell the buttons apart without clicking either one.
export function CopyButton({
  icon = <CopyIcon />,
  label = 'Copy value',
  text,
}: {
  icon?: ReactNode;
  label?: string;
  text: string;
}) {
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

  async function copyText() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={copied ? 'Copied' : label}
            onClick={copyText}
            size="icon-xs"
            type="button"
            variant="terminal"
          >
            {copied ? <CheckIcon /> : icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{copied ? 'Copied' : label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

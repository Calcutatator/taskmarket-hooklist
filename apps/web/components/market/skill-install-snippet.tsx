'use client';

import { CheckIcon, CopyIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

export function SkillInstallSnippet({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  async function copyCommand() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="grid w-full max-w-2xl gap-2 rounded-lg border border-border/80 bg-background/80 p-3 text-left font-mono shadow-[0_16px_34px_-24px_rgb(0_0_0_/_0.85)] backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase text-primary">Agent install</p>
        <Button
          aria-label="Copy skill install command"
          onClick={copyCommand}
          size="xs"
          type="button"
          variant="terminal"
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <code className="block overflow-x-auto whitespace-nowrap rounded-md border border-border/80 bg-surface/90 px-3 py-2 text-xs text-muted-foreground">
        {command}
      </code>
    </div>
  );
}

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
    <div className="flex min-w-0 w-full max-w-2xl items-center gap-2 overflow-hidden rounded-lg border border-border/58 bg-background/44 px-3 py-2 backdrop-blur">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-muted-foreground">
        {command}
      </code>
      <Button
        aria-label="Copy skill install command"
        className="shrink-0"
        onClick={copyCommand}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  );
}

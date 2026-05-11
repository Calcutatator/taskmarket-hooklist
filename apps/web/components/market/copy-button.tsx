'use client';

import { CheckIcon, CopyIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

export function CopyButton({ label = 'Copy value', text }: { label?: string; text: string }) {
  const [copied, setCopied] = useState(false);

  async function copyText() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <Button
      aria-label={copied ? 'Copied' : label}
      onClick={copyText}
      size="icon-xs"
      type="button"
      variant="terminal"
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}

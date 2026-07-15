'use client';

import { useState } from 'react';

/**
 * One-line command with a copy button, styled for the Task Drop agent panel.
 */
export function CopyCommand({ command }: Readonly<{ command: string }>) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard unavailable (permissions/http) — leave the text selectable.
    }
  };

  return (
    <div className="flex items-center gap-3 overflow-x-auto rounded-lg border border-[var(--taskdrop-code-border)] bg-[var(--taskdrop-code)] px-3.5 py-3">
      <code className="font-mono text-[13px] whitespace-nowrap text-[var(--taskdrop-cream)]">
        {command}
      </code>
      <button
        className="ml-auto shrink-0 cursor-pointer rounded-lg bg-[var(--taskdrop-pink)] px-2.5 py-1 text-[11px] font-semibold tracking-wider text-[var(--taskdrop-cream)] uppercase transition-[filter] hover:brightness-90"
        onClick={copy}
        type="button"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

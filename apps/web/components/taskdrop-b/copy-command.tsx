'use client';

import { useState } from 'react';

export function CopyCommand({ command }: Readonly<{ command: string }>) {
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
    <button
      className="ml-auto shrink-0 cursor-pointer rounded-lg bg-[#E74079] px-3 py-2 text-[11px] tracking-[0.06em] text-[#FFF6E8] uppercase"
      onClick={copy}
      type="button"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

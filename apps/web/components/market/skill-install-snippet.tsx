'use client';

import { CheckIcon, CopyIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  SKILL_INSTALL_METHODS,
  type SkillInstallCommands,
  type SkillInstallMethod,
} from '@/lib/skill';
import { cn } from '@/lib/utils';

export function SkillInstallSnippet({
  className,
  commands,
  defaultMethod = 'npx',
}: {
  className?: string;
  commands: SkillInstallCommands;
  defaultMethod?: SkillInstallMethod;
}) {
  const [copied, setCopied] = useState(false);
  const [method, setMethod] = useState<SkillInstallMethod>(defaultMethod);
  const command = commands[method];

  async function copyCommand() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div
      className={cn(
        'grid min-w-0 w-full max-w-2xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 overflow-hidden rounded-lg border border-border/58 bg-background/44 p-2 backdrop-blur sm:flex',
        className
      )}
      data-slot="skill-install-snippet"
    >
      <div
        aria-label="Install method"
        className="inline-flex shrink-0 rounded-full border border-border/58 bg-background/48 p-0.5"
        role="group"
      >
        {SKILL_INSTALL_METHODS.map((option) => (
          <button
            aria-pressed={method === option}
            className={cn(
              'min-h-11 rounded-full px-3 font-mono text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/35 sm:min-h-0 sm:h-7 sm:px-2.5',
              method === option && 'bg-surface-2/72 text-foreground shadow-[var(--shadow-control)]'
            )}
            key={option}
            onClick={() => {
              setMethod(option);
              setCopied(false);
            }}
            type="button"
          >
            {option}
          </button>
        ))}
      </div>
      <code className="order-3 col-span-3 min-w-0 flex-1 overflow-x-auto whitespace-nowrap px-1 font-mono text-xs text-muted-foreground sm:order-none sm:col-span-1">
        {command}
      </code>
      <Button
        aria-label={`Copy ${method} skill install command`}
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

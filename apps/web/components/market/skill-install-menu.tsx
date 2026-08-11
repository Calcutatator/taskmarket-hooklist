'use client';

import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  ExternalLinkIcon,
  PackagePlusIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  SKILL_INSTALL_METHODS,
  SKILLS_MARKET_URL,
  type SkillInstallMethod,
  skillInstallCommands,
} from '@/lib/skill';
import { cn } from '@/lib/utils';

const methodDescriptions: Record<SkillInstallMethod, string> = {
  curl: 'First-party installer',
  npx: 'Recommended through skills.sh',
};

export function SkillInstallMenu({ className }: { className?: string }) {
  const commands = skillInstallCommands();
  const [copiedMethod, setCopiedMethod] = useState<SkillInstallMethod | null>(null);
  // The "Copied" label resets itself after a moment. The handle is kept so the timer dies with
  // the component: an uncleared one fires against an unmounted tree, and in jsdom that lands
  // after the environment is gone -- React's state dispatch then throws `window is not defined`,
  // which vitest reports as an unhandled error and fails a run in which every test passed.
  const resetTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    },
    []
  );

  async function copyCommand(method: SkillInstallMethod) {
    try {
      await navigator.clipboard.writeText(commands[method]);
    } catch {
      return;
    }
    setCopiedMethod(method);
    // Copying a second command before the first has reset would otherwise leave two timers, and
    // the earlier one would clear the newer label.
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    // The handle is cleared as it fires, so the unmount cleanup above never calls
    // clearTimeout on a timer that has already run -- harmless, but it makes "is a reset
    // pending" an honest question to ask of the ref.
    resetTimer.current = window.setTimeout(() => {
      resetTimer.current = null;
      setCopiedMethod(null);
    }, 1600);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className={cn('gap-1.5 px-3.5!', className)}
          size="sm"
          type="button"
          variant="terminal"
        >
          {copiedMethod ? <CheckIcon /> : <PackagePlusIcon />}
          {copiedMethod ? `Copied ${copiedMethod}` : 'Install skill'}
          <ChevronDownIcon className="size-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Install Taskmarket</DropdownMenuLabel>
        {SKILL_INSTALL_METHODS.map((method) => (
          <DropdownMenuItem key={method} onSelect={() => void copyCommand(method)}>
            {copiedMethod === method ? <CheckIcon /> : <CopyIcon />}
            <span className="grid gap-0.5">
              <span>Copy with {method}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {methodDescriptions[method]}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={SKILLS_MARKET_URL} rel="noreferrer" target="_blank">
            <ExternalLinkIcon />
            View on skills.sh
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

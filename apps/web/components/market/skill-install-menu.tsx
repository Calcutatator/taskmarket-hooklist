'use client';

import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  ExternalLinkIcon,
  PackagePlusIcon,
} from 'lucide-react';
import { useState } from 'react';

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

  async function copyCommand(method: SkillInstallMethod) {
    await navigator.clipboard.writeText(commands[method]);
    setCopiedMethod(method);
    window.setTimeout(() => setCopiedMethod(null), 1600);
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

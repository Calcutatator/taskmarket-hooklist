import { InfoIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export function InfoTooltip({ children, label }: { children: ReactNode; label: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          aria-label={label}
          className="inline-flex cursor-default items-center gap-1"
          type="button"
        >
          {children}
          <InfoIcon aria-hidden className="size-3 text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent className="max-w-64">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

'use client';

import { ChevronDown } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function TaskDescriptionDisclosure({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();

  return (
    <div
      aria-label="Description"
      className="overflow-hidden rounded-lg border border-border/58 bg-card/38"
      role="group"
    >
      <button
        aria-controls={contentId}
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse description' : 'Show full description'}
        className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-t-lg px-4 py-3 text-left font-display font-semibold tracking-tight text-foreground hover:bg-muted/20 active:scale-[0.995] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35 focus-visible:outline-none"
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <span>Description</span>
        <span className="flex items-center gap-2">
          <span className="font-mono text-[0.68rem] font-normal uppercase tracking-wide text-muted-foreground">
            {expanded ? 'Show less' : 'Show more'}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn('size-4 text-muted-foreground', expanded && 'rotate-180')}
          />
        </span>
      </button>
      <div
        className={cn(
          'relative border-t border-border/58',
          !expanded && 'max-h-[200px] overflow-hidden'
        )}
        data-collapsed={expanded ? 'false' : 'true'}
        data-testid="task-description-body"
        id={contentId}
      >
        <div className="p-4">{children}</div>
        {!expanded ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent via-card/80 to-card"
            data-testid="task-description-fade"
          />
        ) : null}
      </div>
    </div>
  );
}

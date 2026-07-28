'use client';

import { InfoIcon } from 'lucide-react';
import { useId, useState } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const DREAMS_REWARDS_DOCS_URL = 'https://docs.taskmarket.dev/reference/rewards';
const DREAMS_ESTIMATE_TOOLTIP =
  'Estimated, not guaranteed. Wallet age and weekly reward caps can reduce DREAMS to zero.';

export function DreamsRewardDisclosure() {
  const titleId = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);

  function handleDetailsOpenChange(open: boolean) {
    setDetailsOpen(open);
    if (open) {
      setTooltipOpen(false);
    }
  }

  return (
    <Popover onOpenChange={handleDetailsOpenChange} open={detailsOpen}>
      <TooltipProvider>
        <Tooltip
          onOpenChange={(open) => {
            setTooltipOpen(open && !detailsOpen);
          }}
          open={tooltipOpen}
        >
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                aria-label="Learn how DREAMS bonus eligibility works"
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none"
                type="button"
              >
                <InfoIcon aria-hidden className="size-3.5" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          {detailsOpen ? null : (
            <TooltipContent className="max-w-72 motion-reduce:animate-none">
              {DREAMS_ESTIMATE_TOOLTIP}
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
      <PopoverContent
        align="start"
        aria-labelledby={titleId}
        className="max-h-[var(--radix-popover-content-available-height)] w-96 max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain motion-reduce:animate-none"
      >
        <div className="grid gap-3">
          <div className="grid gap-1">
            <h3 className="font-sans text-sm font-semibold text-foreground" id={titleId}>
              How estimated DREAMS bonuses work
            </h3>
            <p className="text-sm text-muted-foreground">
              Eligibility affects the DREAMS bonus only. The task&apos;s USDC reward is unaffected.
            </p>
          </div>
          <ul className="grid list-disc gap-2 pl-4 text-sm text-muted-foreground">
            <li>
              Wallet age starts with the recipient&apos;s first interaction with the DREAMS reward
              hook, not when the wallet was created. The current ramp is: under 2 weeks earns 0%,
              2–4 weeks earns 25%, 4–8 weeks earns 50%, and 8+ weeks earns 100%.
            </li>
            <li>Weekly global, worker, requester, and task caps can reduce or skip the bonus.</li>
            <li>Bounty estimates use the current rate, which may change before completion.</li>
            <li>Credited DREAMS become claimable and are not sent automatically.</li>
          </ul>
          <a
            className="w-fit rounded-sm font-sans text-sm font-medium text-primary underline underline-offset-4 outline-none hover:text-primary/80 focus-visible:ring-[3px] focus-visible:ring-ring/50"
            href={DREAMS_REWARDS_DOCS_URL}
            rel="noreferrer"
            target="_blank"
          >
            Read the DREAMS reward rules
          </a>
        </div>
      </PopoverContent>
    </Popover>
  );
}

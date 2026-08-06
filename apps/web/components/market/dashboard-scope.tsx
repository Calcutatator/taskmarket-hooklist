'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';

import { DashboardSectionTabsClient } from '@/components/market/dashboard-section-tabs-client';
import type { DashboardSection } from '@/components/market/dashboard-section';
import { DashboardYouView } from '@/components/market/dashboard-you-view';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

type Scope = 'market' | 'you';

// The dashboard personalisation shell. The marketplace sections are rendered on
// the server and passed in through the marketContent slot so the default 'market'
// scope paints from SSR with no client fetch. Switching to 'you' mounts the
// client-only personal view, which sources every visual from the connected
// wallet. Next App Router allows a server-rendered ReactNode to be handed to a
// client component as a prop, which is what keeps the market view fast here.
export function DashboardScope({
  marketContent,
  marketSection,
  marketTitle = 'Marketplace overview',
}: {
  marketContent: ReactNode;
  marketSection: DashboardSection;
  marketTitle?: string;
}) {
  const [scope, setScope] = useState<Scope>('market');

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 lg:px-6">
        <div>
          <p className="font-mono text-xs uppercase text-primary">Console</p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
            {scope === 'market' ? marketTitle : 'Your activity'}
          </h1>
        </div>
        <ToggleGroup
          aria-label="Dashboard scope"
          className="border border-border/68"
          onValueChange={(next) => {
            if (next === 'market' || next === 'you') {
              setScope(next);
            }
          }}
          type="single"
          value={scope}
          variant="outline"
        >
          <ToggleGroupItem value="market">Market</ToggleGroupItem>
          <ToggleGroupItem value="you">You</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {scope === 'market' ? (
        <div className="flex flex-col gap-4 md:gap-6">
          <DashboardSectionTabsClient section={marketSection} />
          {marketContent}
        </div>
      ) : (
        <DashboardYouView />
      )}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';

function compactAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const firstConnector = connectors[0];

  if (mounted && isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
          {compactAddress(address)}
        </span>
        <Button onClick={() => disconnect()} size="sm" type="button" variant="outline">
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <Button
      disabled={!firstConnector}
      onClick={() => firstConnector && connect({ connector: firstConnector })}
      size="sm"
      type="button"
      variant="outline"
    >
      Connect wallet
    </Button>
  );
}

export function SiteHeader() {
  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b border-border/75 bg-background/70 backdrop-blur transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height) rounded-t-xl">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
        <h1 className="text-base font-medium">Taskmarket Console</h1>
        <div className="ml-auto flex items-center gap-2">
          <WalletButton />
          <Button variant="ghost" asChild size="sm" className="hidden sm:flex">
            <a href="/skill.md" className="dark:text-foreground">
              Skill.md
            </a>
          </Button>
          <Button asChild size="sm">
            <a href="/dashboard/tasks/new">Post task</a>
          </Button>
        </div>
      </div>
    </header>
  );
}

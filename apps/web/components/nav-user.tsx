'use client';

import { IconDotsVertical, IconLogout, IconWallet } from '@tabler/icons-react';
import { useAccount, useDisconnect } from 'wagmi';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';

function compactAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function NavUser() {
  const { isMobile } = useSidebar();
  const { address, connector, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const walletLabel = isConnected && address ? compactAddress(address) : 'Wallet';
  const walletDetail = isConnected ? (connector?.name ?? 'Connected wallet') : 'Not connected';
  const fallback = isConnected && address ? '0x' : 'W';

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg grayscale">
                <AvatarFallback className="rounded-lg">{fallback}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{walletLabel}</span>
                <span className="truncate text-xs text-muted-foreground">{walletDetail}</span>
              </div>
              <IconDotsVertical className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarFallback className="rounded-lg">{fallback}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{walletLabel}</span>
                  <span className="truncate text-xs text-muted-foreground">{walletDetail}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            {address ? (
              <div className="px-2 py-1.5 font-mono text-xs break-all text-muted-foreground">
                {address}
              </div>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!isConnected} onSelect={() => disconnect()}>
              {isConnected ? <IconLogout /> : <IconWallet />}
              Disconnect
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

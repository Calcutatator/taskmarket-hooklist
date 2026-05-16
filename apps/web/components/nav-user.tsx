'use client';

import {
  IconDotsVertical,
  IconLogin,
  IconLogout,
  IconRefresh,
  IconWallet,
} from '@tabler/icons-react';

import { FundWalletButton } from '@/components/market/fund-wallet-button';
import { usePrivyAccountState } from '@/components/privy-account-control';
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
import { compactAddress } from '@/lib/format';
import { isPrivyConfigured } from '@/lib/privy-config';

export function NavUser() {
  const { isMobile } = useSidebar();

  if (!isPrivyConfigured()) {
    return (
      <NavUserContent
        connectOrCreateWallet={() => undefined}
        connected={false}
        isMobile={isMobile}
        login={() => undefined}
        logout={() => undefined}
        ready={false}
        walletDetail="Not connected"
      />
    );
  }

  return <NavUserWithPrivy isMobile={isMobile} />;
}

function NavUserWithPrivy({ isMobile }: { isMobile: boolean }) {
  const { address, connectOrCreateWallet, connected, login, logout, ready, walletDetail } =
    usePrivyAccountState();

  return (
    <NavUserContent
      address={address}
      connectOrCreateWallet={connectOrCreateWallet}
      connected={connected}
      isMobile={isMobile}
      login={login}
      logout={logout}
      ready={ready}
      walletDetail={walletDetail}
    />
  );
}

function NavUserContent({
  address,
  connectOrCreateWallet,
  connected,
  isMobile,
  login,
  logout,
  ready,
  walletDetail,
}: {
  address?: string;
  connectOrCreateWallet: () => void | Promise<void>;
  connected: boolean;
  isMobile: boolean;
  login: () => void;
  logout: () => void | Promise<void>;
  ready: boolean;
  walletDetail: string;
}) {
  const walletLabel = connected && address ? compactAddress(address) : 'Wallet';
  const fallback = connected && address ? '0x' : 'W';

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
            {connected && address ? (
              <div className="px-2 py-1.5 font-mono text-xs break-all text-muted-foreground">
                {address}
              </div>
            ) : null}
            <DropdownMenuSeparator />
            {connected && address ? (
              <>
                <div className="px-2 py-1.5">
                  <FundWalletButton address={address} fullWidth size="sm" />
                </div>
                <DropdownMenuItem onSelect={() => connectOrCreateWallet()}>
                  <IconRefresh />
                  Switch wallet
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => logout()}>
                  <IconLogout />
                  Log out
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem disabled={!ready} onSelect={() => login()}>
                {ready ? <IconLogin /> : <IconWallet />}
                Sign in
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

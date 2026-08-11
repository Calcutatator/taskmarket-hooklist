'use client';

import {
  IconDotsVertical,
  IconLogin,
  IconLogout,
  IconRefresh,
  IconWallet,
} from '@tabler/icons-react';

import { FundWalletButton } from '@/components/market/fund-wallet-button';
import { usePrivyAccountState, type WalletAccessStatus } from '@/components/privy-account-control';
import { clearClientAuthState } from '@/lib/clear-client-auth-state';
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
        beginWalletAccess={() => undefined}
        connectOrCreateWallet={() => undefined}
        connected={false}
        isMobile={isMobile}
        logout={() => undefined}
        readyTimedOut={false}
        walletAccessStatus="unavailable"
        walletDetail="Not connected"
      />
    );
  }

  return <NavUserWithPrivy isMobile={isMobile} />;
}

function NavUserWithPrivy({ isMobile }: { isMobile: boolean }) {
  const {
    address,
    beginWalletAccess,
    connectOrCreateWallet,
    connected,
    logout,
    readyTimedOut,
    walletAccessStatus,
    walletDetail,
  } = usePrivyAccountState();

  return (
    <NavUserContent
      address={address}
      beginWalletAccess={beginWalletAccess}
      connectOrCreateWallet={connectOrCreateWallet}
      connected={connected}
      isMobile={isMobile}
      logout={logout}
      readyTimedOut={readyTimedOut}
      walletAccessStatus={walletAccessStatus}
      walletDetail={walletDetail}
    />
  );
}

function NavUserContent({
  address,
  beginWalletAccess,
  connectOrCreateWallet,
  connected,
  isMobile,
  logout,
  readyTimedOut,
  walletAccessStatus,
  walletDetail,
}: {
  address?: string;
  beginWalletAccess: () => void;
  connectOrCreateWallet: () => void | Promise<void>;
  connected: boolean;
  isMobile: boolean;
  logout: () => void | Promise<void>;
  readyTimedOut: boolean;
  walletAccessStatus: WalletAccessStatus | 'unavailable';
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
                <DropdownMenuItem
                  onSelect={() => {
                    clearClientAuthState();
                    connectOrCreateWallet();
                  }}
                >
                  <IconRefresh />
                  Switch wallet
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    clearClientAuthState();
                    void logout();
                  }}
                >
                  <IconLogout />
                  Log out
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem
                disabled={
                  walletAccessStatus === 'unavailable' ||
                  ((walletAccessStatus === 'wallet-loading' ||
                    walletAccessStatus === 'initializing') &&
                    !readyTimedOut)
                }
                onSelect={
                  (walletAccessStatus === 'initializing' ||
                    walletAccessStatus === 'wallet-loading') &&
                  readyTimedOut
                    ? () => window.location.reload()
                    : beginWalletAccess
                }
              >
                {walletAccessStatus === 'signed-out' ? <IconLogin /> : <IconWallet />}
                {walletAccessStatus === 'unavailable'
                  ? 'Wallet unavailable'
                  : walletAccessStatus === 'initializing'
                    ? readyTimedOut
                      ? 'Retry sign in'
                      : 'Loading'
                    : walletAccessStatus === 'wallet-loading'
                      ? readyTimedOut
                        ? 'Retry wallet'
                        : 'Loading wallet'
                      : walletAccessStatus === 'walletless'
                        ? 'Connect wallet'
                        : 'Sign in'}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

'use client';

import { IconLogin, IconLogout, IconRefresh } from '@tabler/icons-react';
import { usePrivy, useWallets, type User } from '@privy-io/react-auth';
import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';

import { FundWalletButton } from '@/components/market/fund-wallet-button';
import { Button } from '@/components/ui/button';
import { compactAddress } from '@/lib/format';
import { isPrivyConfigured } from '@/lib/privy-config';

function sameAddress(left?: string | null, right?: string | null) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

export function privyUserLabel(user?: User | null, fallback = 'Privy account') {
  return (
    user?.email?.address ??
    user?.google?.email ??
    user?.phone?.number ??
    user?.wallet?.address ??
    fallback
  );
}

export function usePrivyAccountState() {
  const { address: wagmiAddress, isConnected } = useAccount();
  const { authenticated, connectOrCreateWallet, login, logout, ready, user } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const activeWallet =
    wallets.find((wallet) => sameAddress(wallet.address, wagmiAddress)) ?? wallets[0];
  const address = wagmiAddress ?? activeWallet?.address;
  const connected = mounted && ready && authenticated && Boolean(address);
  const walletDetail = connected
    ? privyUserLabel(user, activeWallet?.walletClientType ?? 'Connected wallet')
    : 'Not connected';

  return {
    activeWallet,
    address,
    authenticated,
    connectOrCreateWallet,
    connected,
    isConnected,
    login,
    logout,
    mounted,
    ready,
    user,
    walletDetail,
    wallets,
    walletsReady,
  };
}

export function PrivyHeaderAccountControl() {
  if (!isPrivyConfigured()) {
    return (
      <Button
        className="min-h-11 sm:min-h-9"
        disabled
        id="wallet-connect"
        size="sm"
        type="button"
        variant="outline"
      >
        <IconLogin className="size-4" />
        Sign in
      </Button>
    );
  }

  return <PrivyHeaderAccountControlInner />;
}

function PrivyHeaderAccountControlInner() {
  const { address, connectOrCreateWallet, connected, login, logout, ready } =
    usePrivyAccountState();

  if (!ready) {
    return (
      <Button className="min-h-11 sm:min-h-9" disabled size="sm" type="button" variant="outline">
        Loading
      </Button>
    );
  }

  if (!connected || !address) {
    return (
      <Button
        className="min-h-11 sm:min-h-9"
        id="wallet-connect"
        onClick={() => login()}
        size="sm"
        type="button"
        variant="outline"
      >
        <IconLogin className="size-4" />
        Sign in
      </Button>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2" id="wallet-connect">
      <span className="hidden max-w-28 truncate font-mono text-xs text-muted-foreground xl:inline">
        {compactAddress(address)}
      </span>
      <FundWalletButton address={address} size="sm" />
      <Button
        className="min-h-11 sm:min-h-9"
        aria-label="Switch wallet"
        onClick={() => connectOrCreateWallet()}
        size="sm"
        type="button"
        variant="outline"
      >
        <IconRefresh className="size-4" />
        <span className="hidden xl:inline">Switch</span>
      </Button>
      <Button
        className="min-h-11 sm:min-h-9"
        aria-label="Log out"
        onClick={() => logout()}
        size="sm"
        type="button"
        variant="outline"
      >
        <IconLogout className="size-4" />
        <span className="hidden xl:inline">Log out</span>
      </Button>
    </div>
  );
}

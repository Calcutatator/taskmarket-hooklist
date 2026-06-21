'use client';

import {
  IconChevronDown,
  IconLogin,
  IconLogout,
  IconRefresh,
  IconWallet,
} from '@tabler/icons-react';
import { usePrivy, useWallets, type User } from '@privy-io/react-auth';
import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';

import { FundWalletButton } from '@/components/market/fund-wallet-button';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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

// If Privy has not reported ready within this window we treat the SDK as unavailable
// (e.g. a misconfigured app-id or a blocked network request) and surface an explicit
// disabled affordance instead of spinning forever.
const PRIVY_READY_TIMEOUT_MS = 8000;

function PrivyHeaderAccountControlInner() {
  const { address, connectOrCreateWallet, connected, login, logout, ready } =
    usePrivyAccountState();
  const [readyTimedOut, setReadyTimedOut] = useState(false);

  useEffect(() => {
    if (ready) {
      setReadyTimedOut(false);
      return;
    }

    const timer = setTimeout(() => setReadyTimedOut(true), PRIVY_READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  if (!ready) {
    if (readyTimedOut) {
      return (
        <Button
          className="min-h-11 sm:min-h-9"
          disabled
          size="sm"
          title="Sign in is temporarily unavailable. Refresh the page to try again."
          type="button"
          variant="outline"
        >
          <IconLogin className="size-4" />
          Sign in unavailable
        </Button>
      );
    }

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
    <Popover>
      <PopoverTrigger asChild>
        <Button
          aria-label={`Wallet ${compactAddress(address)}`}
          className="min-h-11 sm:min-h-9"
          id="wallet-connect"
          size="sm"
          type="button"
          variant="outline"
        >
          <IconWallet className="size-4" />
          <span className="hidden font-mono text-xs sm:inline">{compactAddress(address)}</span>
          <IconChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid gap-3 p-3">
        <div className="grid gap-1 rounded-lg border border-border/68 bg-background/48 px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">Connected wallet</span>
          <span className="break-all font-mono text-xs text-foreground">{address}</span>
        </div>
        <FundWalletButton address={address} buttonClassName="w-full" fullWidth size="sm" />
        <div className="grid gap-2">
          <Button
            className="w-full justify-start"
            onClick={() => connectOrCreateWallet()}
            size="sm"
            type="button"
            variant="outline"
          >
            <IconRefresh className="size-4" />
            Switch wallet
          </Button>
          <Button
            className="w-full justify-start"
            onClick={() => logout()}
            size="sm"
            type="button"
            variant="outline"
          >
            <IconLogout className="size-4" />
            Log out
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

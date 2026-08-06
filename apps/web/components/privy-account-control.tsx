'use client';

import {
  IconChevronDown,
  IconLogin,
  IconLogout,
  IconRefresh,
  IconWallet,
} from '@tabler/icons-react';
import { usePrivy, useWallets, type User } from '@privy-io/react-auth';
import { useCallback, useEffect, useState } from 'react';
import { useAccount } from 'wagmi';

import { FundWalletButton } from '@/components/market/fund-wallet-button';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { rememberAuthReturnIntent, resumeAuthReturnIntent } from '@/lib/auth-return-intent';
import { compactAddress } from '@/lib/format';
import { isPrivyConfigured } from '@/lib/privy-config';
import { clearClientAuthState } from '@/lib/clear-client-auth-state';

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

export type WalletAccessStatus =
  | 'initializing'
  | 'signed-out'
  | 'wallet-loading'
  | 'walletless'
  | 'connected';

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
  const walletAccessStatus: WalletAccessStatus =
    !mounted || !ready
      ? 'initializing'
      : !authenticated
        ? 'signed-out'
        : !address && !walletsReady
          ? 'wallet-loading'
          : !address
            ? 'walletless'
            : 'connected';
  const walletActionStatus: WalletAccessStatus =
    !mounted || !ready
      ? 'initializing'
      : !authenticated
        ? 'signed-out'
        : isConnected && wagmiAddress
          ? 'connected'
          : !walletsReady
            ? 'wallet-loading'
            : 'walletless';
  const connected = walletAccessStatus === 'connected';
  const walletDetail = connected
    ? privyUserLabel(user, activeWallet?.walletClientType ?? 'Connected wallet')
    : walletAccessStatus === 'initializing'
      ? 'Loading authentication'
      : walletAccessStatus === 'wallet-loading'
        ? 'Loading wallet'
        : 'Not connected';
  const authAndWalletReady =
    ready && (!authenticated || walletsReady || Boolean(isConnected && wagmiAddress));
  const readyTimedOut = usePrivyReadyTimedOut(authAndWalletReady);
  const beginWalletAccess = useCallback(
    (returnTargetId?: string) => {
      if (walletActionStatus !== 'signed-out' && walletActionStatus !== 'walletless') return;

      rememberAuthReturnIntent(returnTargetId);
      if (walletActionStatus === 'walletless') {
        void connectOrCreateWallet();
      } else {
        login();
      }
    },
    [connectOrCreateWallet, login, walletActionStatus]
  );

  useEffect(() => {
    if (walletActionStatus === 'connected') {
      resumeAuthReturnIntent();
    }
  }, [walletActionStatus]);

  return {
    activeWallet,
    address,
    authenticated,
    beginWalletAccess,
    connectOrCreateWallet,
    connected,
    isConnected,
    login,
    logout,
    mounted,
    ready,
    readyTimedOut,
    user,
    walletActionStatus,
    walletAccessStatus,
    walletDetail,
    wallets,
    walletsReady,
  };
}

export function PrivyHeaderAccountControl({
  targetId = 'wallet-connect',
}: {
  targetId?: string;
} = {}) {
  if (!isPrivyConfigured()) {
    return (
      <Button
        className="min-h-11 sm:min-h-9"
        disabled
        id={targetId}
        size="sm"
        title="Sign in is unavailable because authentication is not configured."
        type="button"
        variant="outline"
      >
        <IconLogin className="size-4" />
        Sign in unavailable
      </Button>
    );
  }

  return <PrivyHeaderAccountControlInner targetId={targetId} />;
}

// If Privy has not reported ready within this window, offer an explicit recovery
// action instead of leaving the user in a loading state indefinitely.
const PRIVY_READY_TIMEOUT_MS = 8000;

function usePrivyReadyTimedOut(ready: boolean) {
  const [readyTimedOut, setReadyTimedOut] = useState(false);

  useEffect(() => {
    if (ready) {
      setReadyTimedOut(false);
      return;
    }

    const timer = setTimeout(() => setReadyTimedOut(true), PRIVY_READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  return readyTimedOut;
}

export function PrivyWalletAccessButton({
  className,
  label = 'Sign in',
  returnTargetId,
  walletlessLabel = 'Connect wallet',
}: {
  className?: string;
  label?: string;
  returnTargetId?: string;
  walletlessLabel?: string;
}) {
  if (!isPrivyConfigured()) {
    return (
      <Button
        className={className}
        disabled
        title="Sign in is unavailable because authentication is not configured."
        type="button"
        variant="outline"
      >
        <IconLogin className="size-4" />
        Sign in unavailable
      </Button>
    );
  }

  return (
    <PrivyWalletAccessButtonInner
      className={className}
      label={label}
      returnTargetId={returnTargetId}
      walletlessLabel={walletlessLabel}
    />
  );
}

function PrivyWalletAccessButtonInner({
  className,
  label,
  returnTargetId,
  walletlessLabel,
}: {
  className?: string;
  label: string;
  returnTargetId?: string;
  walletlessLabel: string;
}) {
  const { beginWalletAccess, readyTimedOut, walletActionStatus } = usePrivyAccountState();

  if (
    (walletActionStatus === 'initializing' || walletActionStatus === 'wallet-loading') &&
    readyTimedOut
  ) {
    const walletTimedOut = walletActionStatus === 'wallet-loading';

    return (
      <Button
        className={className}
        onClick={() => window.location.reload()}
        title="Authentication did not finish loading."
        type="button"
        variant="outline"
      >
        <IconRefresh className="size-4" />
        {walletTimedOut ? 'Retry wallet' : 'Retry sign in'}
      </Button>
    );
  }

  const disabled =
    walletActionStatus === 'initializing' ||
    walletActionStatus === 'wallet-loading' ||
    walletActionStatus === 'connected';
  const buttonLabel =
    walletActionStatus === 'initializing'
      ? 'Loading sign in'
      : walletActionStatus === 'wallet-loading'
        ? 'Loading wallet'
        : walletActionStatus === 'walletless'
          ? walletlessLabel
          : walletActionStatus === 'connected'
            ? 'Wallet connected'
            : label;

  return (
    <Button
      aria-busy={walletActionStatus === 'initializing' || walletActionStatus === 'wallet-loading'}
      className={className}
      disabled={disabled}
      id={returnTargetId}
      onClick={() => beginWalletAccess(returnTargetId)}
      type="button"
      variant="outline"
    >
      {walletActionStatus === 'walletless' || walletActionStatus === 'connected' ? (
        <IconWallet className="size-4" />
      ) : (
        <IconLogin className="size-4" />
      )}
      {buttonLabel}
    </Button>
  );
}

function PrivyHeaderAccountControlInner({ targetId }: { targetId: string }) {
  const {
    address,
    beginWalletAccess,
    connectOrCreateWallet,
    logout,
    readyTimedOut,
    walletAccessStatus,
  } = usePrivyAccountState();

  if (walletAccessStatus === 'initializing') {
    if (readyTimedOut) {
      return (
        <Button
          onClick={() => window.location.reload()}
          size="sm"
          title="Authentication did not finish loading."
          type="button"
          variant="outline"
        >
          <IconRefresh className="size-4" />
          Retry sign in
        </Button>
      );
    }

    return (
      <Button disabled size="sm" type="button" variant="outline">
        Loading
      </Button>
    );
  }

  if (walletAccessStatus === 'wallet-loading') {
    if (readyTimedOut) {
      return (
        <Button
          onClick={() => window.location.reload()}
          size="sm"
          title="Wallets did not finish loading."
          type="button"
          variant="outline"
        >
          <IconRefresh className="size-4" />
          Retry wallet
        </Button>
      );
    }

    return (
      <Button aria-busy disabled size="sm" type="button" variant="outline">
        Loading wallet
      </Button>
    );
  }

  if (walletAccessStatus === 'signed-out' || walletAccessStatus === 'walletless' || !address) {
    const walletless = walletAccessStatus === 'walletless';

    return (
      <Button
        id={targetId}
        onClick={() => beginWalletAccess(targetId)}
        size="sm"
        type="button"
        variant="outline"
      >
        {walletless ? <IconWallet className="size-4" /> : <IconLogin className="size-4" />}
        {walletless ? 'Connect wallet' : 'Sign in'}
      </Button>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          aria-label={`Wallet ${compactAddress(address)}`}
          id={targetId}
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
            onClick={() => {
              clearClientAuthState();
              connectOrCreateWallet();
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            <IconRefresh className="size-4" />
            Switch wallet
          </Button>
          <Button
            className="w-full justify-start"
            onClick={() => {
              clearClientAuthState();
              void logout();
            }}
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

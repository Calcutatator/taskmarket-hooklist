'use client';

import { useEffect, useState } from 'react';
import { IconCoin } from '@tabler/icons-react';
import { useFiatOnramp } from '@privy-io/react-auth';
import { STANDARD_X402_ACTION_AMOUNT } from '@taskmarket/shared';
import { useAccount } from 'wagmi';

import { CopyButton } from '@/components/market/copy-button';
import { Button } from '@/components/ui/button';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { isPrivyConfigured } from '@/lib/privy-config';
import { cn } from '@/lib/utils';

export type FundingStatus = 'submitted' | 'confirmed';

export const PAID_ACTION_COST_BASE_UNITS = BigInt(STANDARD_X402_ACTION_AMOUNT);

export type ActionFundingPrompt = {
  balanceUsdc: string;
  defaultAmount: string;
  shortfallBaseUnits: string;
};

type FundWalletButtonProps = {
  address?: string | null;
  buttonClassName?: string;
  className?: string;
  defaultAmount?: string;
  fullWidth?: boolean;
  label?: string;
  onStatus?: (status: FundingStatus) => void;
  size?: React.ComponentProps<typeof Button>['size'];
  variant?: React.ComponentProps<typeof Button>['variant'];
};

type FundingGuardProps = {
  address?: string | null;
  children?: React.ReactNode;
  className?: string;
  defaultAmount?: string;
  message: string;
  onStatus?: (status: FundingStatus) => void;
};

export function getPrivyFundingChain(env = process.env) {
  return env.NEXT_PUBLIC_CHAIN_ID === '84532' ? 'eip155:84532' : 'eip155:8453';
}

export function getPrivyFundingEnvironment(env = process.env) {
  return env.NEXT_PUBLIC_PRIVY_FUNDING_ENV === 'production' ? 'production' : 'sandbox';
}

export function isPrivyFiatOnboardingEnabled(env = process.env) {
  return ['1', 'true'].includes(
    String(env.NEXT_PUBLIC_PRIVY_FIAT_ONBOARDING_ENABLED ?? '').toLowerCase()
  );
}

function paidActionDefaultAmount(baseUnits: string) {
  const parsed = Number(baseUnits) / 1_000_000;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return '1';
  }

  return Math.max(parsed, 1).toFixed(2);
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }

  return '';
}

function isFundingModalDismissal(error: unknown) {
  if (error == null) {
    return true;
  }

  const message = getErrorMessage(error);
  return /\b(user|modal|flow)\b.*\b(closed?|dismissed?|cancell?ed|exited?)\b/i.test(message);
}

async function loadActionFundingPrompt(address: string): Promise<ActionFundingPrompt | null> {
  const res = await fetch(
    `${getBrowserApiBaseUrl()}/api/wallet/balance?address=${encodeURIComponent(address)}`
  );
  if (!res.ok) {
    return null;
  }

  const balance = (await res.json()) as Partial<{
    balanceBaseUnits: string;
    balanceUsdc: string;
  }>;
  if (typeof balance.balanceBaseUnits !== 'string' || typeof balance.balanceUsdc !== 'string') {
    return null;
  }

  const shortfall = PAID_ACTION_COST_BASE_UNITS - BigInt(balance.balanceBaseUnits);
  if (shortfall <= 0n) {
    return null;
  }

  const shortfallBaseUnits = shortfall.toString();
  return {
    balanceUsdc: balance.balanceUsdc,
    defaultAmount: paidActionDefaultAmount(shortfallBaseUnits),
    shortfallBaseUnits,
  };
}

export function usePaidActionFundingPrompt({
  address,
  enabled,
}: {
  address?: string | null;
  enabled: boolean;
}) {
  const [actionFundingPrompt, setActionFundingPrompt] = useState<ActionFundingPrompt | null>(null);
  const [balanceCheckNonce, setBalanceCheckNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;

    if (!address || !enabled || !isPrivyFiatOnboardingEnabled()) {
      setActionFundingPrompt(null);
      return;
    }

    loadActionFundingPrompt(address)
      .then((prompt) => {
        if (!cancelled) {
          setActionFundingPrompt(prompt);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setActionFundingPrompt(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [address, balanceCheckNonce, enabled]);

  return {
    actionFundingPrompt,
    recheckActionFunding: () => setBalanceCheckNonce((value) => value + 1),
  };
}

function HowToFundFallback({
  address,
  className,
  fullWidth = false,
}: {
  address?: string | null;
  className?: string;
  fullWidth?: boolean;
}) {
  const account = useAccount();
  const fundingAddress = address ?? account.address ?? null;

  if (!fundingAddress) {
    return null;
  }

  return (
    <div className={cn(fullWidth ? 'grid w-full' : 'inline-grid w-fit', 'gap-2', className)}>
      <p className="text-xs leading-5 text-muted-foreground">
        Send USDC on Base to this address to fund your wallet.
      </p>
      <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border/68 bg-background/48 px-3 py-2">
        <span className="min-w-0 break-all font-mono text-xs text-foreground">
          {fundingAddress}
        </span>
        <CopyButton label="Copy wallet address" text={fundingAddress} />
      </div>
    </div>
  );
}

export function FundWalletButton(props: FundWalletButtonProps) {
  const { buttonClassName, className, fullWidth, label, size, variant } = props;

  if (!isPrivyFiatOnboardingEnabled()) {
    return (
      <HowToFundFallback address={props.address} className={className} fullWidth={fullWidth} />
    );
  }

  if (!isPrivyConfigured()) {
    return (
      <div className={cn(fullWidth ? 'grid w-full' : 'inline-grid w-fit', 'gap-2', className)}>
        <Button
          className={cn(fullWidth && 'w-full', buttonClassName)}
          disabled
          size={size ?? 'sm'}
          type="button"
          variant={variant ?? 'outline'}
        >
          <IconCoin className="size-4" />
          <span className={cn(fullWidth ? 'inline' : 'hidden xl:inline')}>
            {label ?? 'Add USDC'}
          </span>
        </Button>
      </div>
    );
  }

  return <FundWalletButtonInner {...props} />;
}

function FundWalletButtonInner({
  address,
  buttonClassName,
  className,
  defaultAmount,
  fullWidth = false,
  label = 'Add USDC',
  onStatus,
  size = 'sm',
  variant = 'outline',
}: FundWalletButtonProps) {
  const { fund } = useFiatOnramp();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFund() {
    if (!address || busy) {
      return;
    }

    setBusy(true);
    setMessage(null);
    setError(null);

    try {
      const result = await fund({
        ...(defaultAmount ? { defaultAmount } : {}),
        destination: {
          address,
          asset: 'usdc',
          chain: getPrivyFundingChain(),
        },
        environment: getPrivyFundingEnvironment(),
        source: {
          assets: ['usd', 'eur', 'gbp'],
          defaultAsset: 'usd',
        },
      });

      onStatus?.(result.status);
      setMessage(
        result.status === 'confirmed'
          ? 'Funding confirmed. Checking balance.'
          : 'Purchase submitted. Funds can take a few minutes to arrive.'
      );
    } catch (error) {
      if (!isFundingModalDismissal(error)) {
        setError('Funding could not start. Try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn(fullWidth ? 'grid w-full' : 'inline-grid w-fit', 'gap-2', className)}>
      <Button
        className={cn(fullWidth && 'w-full', buttonClassName)}
        disabled={!address || busy}
        onClick={handleFund}
        size={size}
        type="button"
        variant={variant}
      >
        <IconCoin className="size-4" />
        <span className={cn(fullWidth ? 'inline' : 'hidden xl:inline')}>
          {busy ? 'Opening funding' : label}
        </span>
      </Button>
      {message ? <p className="text-xs leading-5 text-muted-foreground">{message}</p> : null}
      {error ? (
        <p className="text-xs leading-5 text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function FundingGuard({
  address,
  children,
  className,
  defaultAmount,
  message,
  onStatus,
}: FundingGuardProps) {
  return (
    <div
      className={cn(
        'grid gap-3 rounded-xl border border-primary/36 bg-primary/10 p-4 shadow-[var(--shadow-soft)]',
        className
      )}
    >
      <p className="text-sm leading-5 text-foreground">{message}</p>
      {children}
      <FundWalletButton
        address={address}
        buttonClassName="w-full sm:w-fit"
        className="w-full sm:w-fit"
        defaultAmount={defaultAmount}
        onStatus={onStatus}
      />
    </div>
  );
}

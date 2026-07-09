'use client';

import { useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { dreamsToUsd, formatDreams } from '@taskmarket/shared';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { trpc } from '@/lib/api/client';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { explorerTxUrl } from '@/lib/explorer';
import { formatUsdcUnits } from '@/lib/format';

type WithdrawState = 'idle' | 'signing' | 'submitting';

export function DreamsRewardsCard() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [state, setState] = useState<WithdrawState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ txHash: string; claimedDreams: string } | null>(null);

  const balanceQuery = trpc.wallet.dreamsBalance.useQuery(
    { address: address ?? '' },
    { enabled: Boolean(address) }
  );
  const rateQuery = trpc.wallet.exchangeRate.useQuery();
  const withdrawalAddressQuery = trpc.wallet.getWithdrawalAddress.useQuery(
    { address: address ?? '' },
    { enabled: Boolean(address) }
  );

  if (!isConnected || !address) {
    return null;
  }

  const claimableBaseUnits = balanceQuery.data?.claimableBaseUnits ?? '0';
  const dreamsPerUsdc = rateQuery.data?.dreamsPerUsdc ?? '0';
  const hasClaimable = claimableBaseUnits !== '0';
  const hasRate = dreamsPerUsdc !== '0';
  const usdEquivalent = hasRate ? dreamsToUsd(claimableBaseUnits, dreamsPerUsdc) : null;
  const destination = withdrawalAddressQuery.data?.withdrawalAddress ?? address;
  const busy = state !== 'idle';

  // DREAMS rewards only exist once the reward hook is configured on the backend;
  // hide the card entirely rather than show an empty/zeroed state.
  if (!balanceQuery.isLoading && !hasRate && !hasClaimable) {
    return null;
  }

  async function handleWithdraw() {
    setError(null);
    setResult(null);
    setState('signing');

    const message = `taskmarket:withdraw-dreams:${destination}`;
    let signature: string;
    try {
      signature = await signMessageAsync({ message });
    } catch (err) {
      setState('idle');
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      if (msg.includes('user rejected') || msg.includes('user denied')) {
        return;
      }
      setError(err instanceof Error ? err.message : 'Signing failed');
      return;
    }

    setState('submitting');
    try {
      const res = await fetch(`${getBrowserApiBaseUrl()}/api/wallet/withdraw-dreams`, {
        body: JSON.stringify({ workerAddress: address, destination, signature }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        throw new Error(errBody.message ?? errBody.error ?? `Server error: ${res.status}`);
      }
      const data = (await res.json()) as { txHash: string; claimedBaseUnits: string };
      setResult({ txHash: data.txHash, claimedDreams: formatDreams(data.claimedBaseUnits) });
      await balanceQuery.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Withdraw failed');
    } finally {
      setState('idle');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>DREAMS rewards</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {balanceQuery.isLoading ? (
          <div className="grid gap-2" aria-label="Loading DREAMS balance">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-40" />
          </div>
        ) : (
          <>
            <div className="grid gap-1 text-sm">
              <span className="text-muted-foreground">Claimable balance</span>
              <span className="font-mono text-lg font-semibold text-foreground">
                {formatDreams(claimableBaseUnits)} DREAMS
              </span>
              {usdEquivalent ? (
                <span className="text-xs text-muted-foreground">
                  ~{formatUsdcUnits(usdEquivalent)}
                </span>
              ) : null}
            </div>
            {hasRate ? (
              <p className="text-xs text-muted-foreground">
                Rate: 1 USDC = {formatDreams(dreamsPerUsdc)} DREAMS
              </p>
            ) : null}
            <Button disabled={busy || !hasClaimable} onClick={handleWithdraw} size="sm">
              {state === 'signing'
                ? 'Sign in wallet…'
                : state === 'submitting'
                  ? 'Withdrawing…'
                  : 'Withdraw DREAMS'}
            </Button>
            {destination !== address ? (
              <p className="text-xs text-muted-foreground">
                Sends to your registered withdrawal address.
              </p>
            ) : null}
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            {result ? (
              <div className="grid gap-1 text-xs text-muted-foreground">
                <span>Withdrew {result.claimedDreams} DREAMS.</span>
                <a
                  className="underline-offset-4 hover:text-foreground hover:underline"
                  href={explorerTxUrl(result.txHash) ?? '#'}
                  rel="noreferrer"
                  target="_blank"
                >
                  View transaction
                </a>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

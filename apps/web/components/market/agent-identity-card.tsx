'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { explorerTxUrl } from '@/lib/explorer';
import { payX402Post, type X402Step } from '@/lib/x402-client';

type IdentityStatus = {
  agentId: string | null;
  registered: boolean;
};

export function AgentIdentityCard() {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const [status, setStatus] = useState<IdentityStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [step, setStep] = useState<X402Step | 'idle'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [registeredAgentId, setRegisteredAgentId] = useState<string | null>(null);

  useEffect(() => {
    if (!isConnected || !address) return;
    let cancelled = false;
    setLoadingStatus(true);

    async function load() {
      try {
        const res = await fetch(
          `${getBrowserApiBaseUrl()}/api/identity/status?address=${encodeURIComponent(address!)}`
        );
        if (!res.ok) return;
        const body = (await res.json()) as IdentityStatus;
        if (!cancelled) setStatus(body);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoadingStatus(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [address, isConnected]);

  if (!isConnected || !address) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Connect a wallet</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Connect with the button in the top right to manage your identity.
          </p>
        </CardContent>
      </Card>
    );
  }

  const existingAgentId = registeredAgentId ?? status?.agentId ?? null;
  const busy = step !== 'idle';

  async function handleRegister() {
    setError(null);
    const result = await payX402Post<{ agentId: string; alreadyRegistered: boolean }>(
      `/api/identity/register`,
      { source: 'web' },
      { address: address!, apiUrl: getBrowserApiBaseUrl(), signTypedDataAsync, switchChainAsync },
      setStep
    );
    setStep('idle');
    if (result.ok) {
      setRegisteredAgentId(result.data.agentId);
      setTxHash(result.txHash ?? null);
    } else if (!result.rejected) {
      setError(result.error);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle>Identity</CardTitle>
          {existingAgentId ? <Badge variant="terminal">Human</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Wallet</span>
          <code className="font-mono text-xs">{address}</code>
        </div>
        {loadingStatus ? (
          <div className="grid gap-2" aria-label="Checking identity status">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-48" />
          </div>
        ) : existingAgentId ? (
          <div className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Agent ID</span>
            <Link
              className="font-mono text-primary hover:underline"
              href={`/dashboard/agents/${existingAgentId}` as Route}
            >
              {existingAgentId}
            </Link>
            {txHash ? (
              <a
                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                href={explorerTxUrl(txHash) ?? '#'}
                rel="noreferrer"
                target="_blank"
              >
                View registration tx
              </a>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-2">
            <p className="text-sm text-muted-foreground">
              You don&apos;t have an identity yet. Registering creates an ERC-8004 agent ID
              permanently tagged as a human, so feedback and ratings accumulate under a stable
              identifier.
            </p>
            <Button disabled={busy} onClick={handleRegister} size="sm">
              {step === 'payment'
                ? 'Fetching payment…'
                : step === 'signing'
                  ? 'Sign payment…'
                  : step === 'submitting'
                    ? 'Registering…'
                    : 'Register identity'}
            </Button>
            <p className="text-xs text-muted-foreground">
              Costs 0.001 USDC. Classification (human) is immutable.
            </p>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

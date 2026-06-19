'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { IconBolt, IconCoin, IconFileText } from '@tabler/icons-react';
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi';

import { MarketLiquidityPanel } from '@/components/market/market-liquidity';
import { FundingGuard, type FundingStatus } from '@/components/market/fund-wallet-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { MarketStats } from '@/lib/api/server';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import {
  buildCreateTaskPayload,
  type CreateTaskFieldErrors,
  type CreateTaskFormValues,
  validateCreateTask,
} from '@/lib/market/create-task-form';
import { formatUsdcUnits } from '@/lib/format';
import { auctionTypeOptions, taskModeOptions } from '@/lib/market/task-mode-config';
import { findTemplate, taskTemplates } from '@/lib/market/task-templates';
import { parseUnits } from 'viem';
import { cn } from '@/lib/utils';

import type { WizardFormValues } from '../create-task-wizard';

const apiUrl = getBrowserApiBaseUrl();

// Platform fee charged on task payout. The contract deducts this from the reward
// at acceptance (worker receives reward minus fee; the requester escrows the full
// reward), so the x402 amount equals the reward and the breakdown is display-only.
const PLATFORM_FEE_BPS = 500;

type PublishPhase = 'form' | 'payment' | 'signing' | 'submitting';

type WalletBalance = {
  balanceBaseUnits: string;
  balanceUsdc: string;
};

type FundingPromptState = {
  balanceBaseUnits: string;
  balanceUsdc: string;
  defaultAmount: string;
  requiredBaseUnits: string;
  shortfallBaseUnits: string;
};

const stepCopy: Record<PublishPhase, { label: string; text: string }> = {
  form: {
    label: 'Ready',
    text: 'Review the brief, mode, reward, and deadlines.',
  },
  payment: {
    label: 'Payment challenge',
    text: 'Requesting x402 terms from the backend.',
  },
  signing: {
    label: 'Wallet signature',
    text: 'Sign the USDC authorization. No gas is required.',
  },
  submitting: {
    label: 'Publishing task',
    text: 'Submitting the signed task and task terms.',
  },
};

function randomNonce() {
  return `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}` as `0x${string}`;
}

function onrampDefaultAmount(baseUnits: string) {
  const parsed = Number(baseUnits) / 1_000_000;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return '10';
  }

  return Math.max(parsed, 1).toFixed(2);
}

function buildFundingPrompt(
  balance: WalletBalance,
  requiredBaseUnits: string
): FundingPromptState | null {
  const balanceBaseUnits = BigInt(balance.balanceBaseUnits);
  const required = BigInt(requiredBaseUnits);

  if (balanceBaseUnits >= required) {
    return null;
  }

  const shortfallBaseUnits = (required - balanceBaseUnits).toString();
  return {
    balanceBaseUnits: balance.balanceBaseUnits,
    balanceUsdc: balance.balanceUsdc,
    defaultAmount: onrampDefaultAmount(shortfallBaseUnits),
    requiredBaseUnits,
    shortfallBaseUnits,
  };
}

async function loadWalletBalance(address: string): Promise<WalletBalance> {
  const balanceRes = await fetch(
    `${apiUrl}/api/wallet/balance?address=${encodeURIComponent(address)}`
  );
  if (!balanceRes.ok) {
    throw new Error(`Wallet balance check failed: ${balanceRes.status}`);
  }

  const balance = (await balanceRes.json()) as Partial<WalletBalance>;
  if (typeof balance.balanceBaseUnits !== 'string' || typeof balance.balanceUsdc !== 'string') {
    throw new Error('Wallet balance response was malformed');
  }

  return {
    balanceBaseUnits: balance.balanceBaseUnits,
    balanceUsdc: balance.balanceUsdc,
  };
}

// Compute the cost breakdown for display. The reward is escrowed in full; the
// platform fee is deducted from it on payout, so the worker nets reward - fee.
function computeCostBreakdown(reward: string) {
  let rewardBaseUnits: bigint;
  try {
    rewardBaseUnits = reward.trim() ? parseUnits(reward, 6) : 0n;
  } catch {
    rewardBaseUnits = 0n;
  }

  const feeBaseUnits = (rewardBaseUnits * BigInt(PLATFORM_FEE_BPS)) / 10_000n;
  const workerBaseUnits = rewardBaseUnits - feeBaseUnits;

  return {
    escrowed: rewardBaseUnits.toString(),
    fee: feeBaseUnits.toString(),
    workerNet: workerBaseUnits.toString(),
  };
}

type StepPublishProps = {
  form: UseFormReturn<WizardFormValues>;
  marketStats: MarketStats | null;
  ready: boolean;
  connectOrCreateWallet: () => void | Promise<void>;
  onEditBrief: () => void;
  onValidationError: (errors: CreateTaskFieldErrors) => void;
};

export function StepPublish({
  connectOrCreateWallet,
  form,
  marketStats,
  onEditBrief,
  onValidationError,
  ready,
}: StepPublishProps) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const [phase, setPhase] = useState<PublishPhase>('form');
  const [error, setError] = useState<string | null>(null);
  const [fundingPrompt, setFundingPrompt] = useState<FundingPromptState | null>(null);
  const [fundingNotice, setFundingNotice] = useState<string | null>(null);

  const walletReady = isConnected && Boolean(address);
  const isSubmitting = phase !== 'form';

  const { templateId, ...values } = form.getValues();
  const selectedTemplate = findTemplate(templateId) ?? taskTemplates[0];
  const currentMode =
    taskModeOptions.find((taskMode) => taskMode.value === values.mode) ?? taskModeOptions[0];
  const currentAuctionType =
    auctionTypeOptions.find((type) => type.value === values.auctionType) ?? auctionTypeOptions[0];
  const CurrentModeIcon = currentMode.icon;
  const StepIcon = phase === 'form' ? IconFileText : phase === 'payment' ? IconCoin : IconBolt;

  const tagList = values.tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  const breakdown = computeCostBreakdown(values.reward);

  async function handlePublish() {
    const submitValues = { ...form.getValues() };
    delete (submitValues as Partial<WizardFormValues>).templateId;
    const valuesToSubmit: CreateTaskFormValues = submitValues;
    const body = buildCreateTaskPayload(valuesToSubmit);

    setError(null);
    setFundingPrompt(null);
    setFundingNotice(null);

    const validationErrors = validateCreateTask(valuesToSubmit);
    if (validationErrors) {
      onValidationError(validationErrors);
      return;
    }

    if (!address) {
      setError('Connect a wallet before publishing this task.');
      return;
    }

    try {
      const rewardBaseUnits = String(body.reward);
      const balance = await loadWalletBalance(address);
      const nextFundingPrompt = buildFundingPrompt(balance, rewardBaseUnits);
      if (nextFundingPrompt) {
        setFundingPrompt(nextFundingPrompt);
        return;
      }

      setPhase('payment');
      const probeRes = await fetch(`${apiUrl}/api/tasks`, {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (probeRes.status !== 402) {
        const probeBody = await probeRes.json().catch(() => ({}) as { error?: string });
        throw new Error(probeBody.error ?? `Task creation failed (status ${probeRes.status}).`);
      }

      const payReq = await probeRes.json();
      const accepted = payReq.accepts?.[0];
      const eip712 = accepted?.extra?.eip712;
      if (!accepted || !eip712?.domain) {
        throw new Error('Payment challenge did not include EIP-712 terms');
      }

      setPhase('signing');
      const requiredChainId = Number(eip712.domain.chainId);
      try {
        await switchChainAsync({ chainId: requiredChainId });
      } catch {
        await (
          window as Window & {
            ethereum?: {
              request?: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
            };
          }
        ).ethereum?.request?.({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${requiredChainId.toString(16)}` }],
        });
      }

      const validBefore = BigInt(Math.floor(Date.now() / 1000) + 300);
      const nonce = randomNonce();
      const signature = await signTypedDataAsync({
        domain: {
          chainId: requiredChainId,
          name: eip712.domain.name,
          verifyingContract: eip712.domain.verifyingContract as `0x${string}`,
          version: eip712.domain.version,
        },
        message: {
          from: address,
          nonce,
          to: accepted.payTo as `0x${string}`,
          validAfter: 0n,
          validBefore,
          value: BigInt(accepted.amount),
        },
        primaryType: 'TransferWithAuthorization',
        types: { TransferWithAuthorization: eip712.types.TransferWithAuthorization },
      });

      const paymentPayload = {
        accepted: {
          amount: accepted.amount,
          asset: accepted.asset,
          maxTimeoutSeconds: accepted.maxTimeoutSeconds,
          network: accepted.network,
          payTo: accepted.payTo,
          scheme: accepted.scheme,
        },
        network: accepted.network,
        payload: {
          authorization: {
            from: address,
            nonce,
            to: accepted.payTo,
            validAfter: '0',
            validBefore: validBefore.toString(),
            value: accepted.amount,
          },
          signature,
        },
        scheme: accepted.scheme,
        x402Version: 2,
      };

      setPhase('submitting');
      const createRes = await fetch(`${apiUrl}/api/tasks`, {
        body: JSON.stringify(body),
        headers: {
          'Content-Type': 'application/json',
          'payment-signature': btoa(JSON.stringify(paymentPayload)),
        },
        method: 'POST',
      });
      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        throw new Error(err.error ?? `Server error: ${createRes.status}`);
      }

      const result = (await createRes.json()) as { taskId?: string };
      router.push(
        result.taskId ? `/dashboard/tasks/${result.taskId}?published=1` : '/dashboard/tasks'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Task creation failed');
      setPhase('form');
    }
  }

  async function handleFundingStatus(status: FundingStatus) {
    if (status === 'submitted') {
      setFundingNotice('Purchase submitted. Funds can take a few minutes to arrive.');
      return;
    }

    setFundingNotice('Funding confirmed. Checking wallet balance.');

    if (!address || !fundingPrompt) {
      return;
    }

    try {
      const balance = await loadWalletBalance(address);
      const nextFundingPrompt = buildFundingPrompt(balance, fundingPrompt.requiredBaseUnits);
      setFundingPrompt(nextFundingPrompt);
      setFundingNotice(
        nextFundingPrompt
          ? 'Funding confirmed, but the wallet still needs more USDC.'
          : 'Funding confirmed. Wallet balance is ready.'
      );
    } catch (err) {
      setFundingNotice(err instanceof Error ? err.message : 'Funding confirmed. Recheck balance.');
    }
  }

  function handleConnectWallet() {
    setError(null);
    connectOrCreateWallet();
  }

  const buttonLabel =
    phase === 'payment'
      ? 'Fetching payment terms'
      : phase === 'signing'
        ? 'Sign payment'
        : phase === 'submitting'
          ? 'Creating task'
          : walletReady
            ? 'Fund and publish'
            : 'Connect wallet to post';

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="grid gap-6">
        <Card>
          <CardHeader className="border-b border-border/75">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>Review</CardTitle>
                <CardDescription className="mt-2">
                  Confirm the task details before signing the payment.
                </CardDescription>
              </div>
              <Button onClick={onEditBrief} size="sm" type="button" variant="outline">
                Edit
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid gap-5 pt-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="terminal">{selectedTemplate.label}</Badge>
              <Badge variant="secondary">{currentMode.label}</Badge>
            </div>

            <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-border/68 font-mono text-xs uppercase shadow-[var(--shadow-soft)]">
              <div className="border-r border-border/70 p-3">
                <span className="block text-muted-foreground">Reward</span>
                <span className="mt-1 block text-foreground">
                  {formatUsdcUnits(breakdown.escrowed)}
                </span>
              </div>
              <div className="p-3">
                <span className="block text-muted-foreground">Duration</span>
                <span className="mt-1 block text-foreground">{values.duration || '0'}h</span>
              </div>
            </div>

            <div className="grid gap-2">
              <p className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">
                Brief
              </p>
              <p className="line-clamp-6 whitespace-pre-line text-sm leading-6 text-foreground">
                {values.description || 'No brief written yet.'}
              </p>
              <button
                className="w-fit text-xs font-semibold text-primary underline-offset-4 hover:underline"
                onClick={onEditBrief}
                type="button"
              >
                Edit brief
              </button>
            </div>

            {tagList.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {tagList.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            ) : null}

            {values.mode === 'auction' ? (
              <div className="grid gap-1 rounded-xl border border-border/68 bg-surface/42 p-4 text-sm leading-5 text-muted-foreground shadow-[var(--shadow-soft)]">
                <p className="font-semibold text-foreground">{currentAuctionType.label} auction</p>
                <p>{currentAuctionType.description}</p>
                {values.maxPrice ? <p>Max price ${values.maxPrice}</p> : null}
              </div>
            ) : null}

            {values.mode === 'benchmark' && values.metricDescription ? (
              <div className="grid gap-1 rounded-xl border border-border/68 bg-surface/42 p-4 text-sm leading-5 text-muted-foreground shadow-[var(--shadow-soft)]">
                <p className="font-semibold text-foreground">Benchmark</p>
                <p>
                  {values.metricDescription}
                  {values.metricTarget ? ` (target ${values.metricTarget})` : ''}
                </p>
              </div>
            ) : null}

            <div className="grid gap-2 rounded-xl border border-border/68 bg-surface/42 p-4 shadow-[var(--shadow-soft)]">
              <p className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">
                Cost breakdown
              </p>
              <dl className="grid gap-1.5 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">You escrow</dt>
                  <dd className="font-mono text-foreground">
                    {formatUsdcUnits(breakdown.escrowed)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Platform fee (5%)</dt>
                  <dd className="font-mono text-foreground">{formatUsdcUnits(breakdown.fee)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-foreground">Worker receives</dt>
                  <dd className="font-mono font-semibold text-foreground">
                    {formatUsdcUnits(breakdown.workerNet)}
                  </dd>
                </div>
              </dl>
              <p className="text-xs leading-5 text-muted-foreground">
                You escrow the full reward. The worker receives the reward minus a 5% platform fee
                on payout.
              </p>
            </div>
          </CardContent>
        </Card>

        <MarketLiquidityPanel stats={marketStats} />
      </div>

      <aside className="grid gap-6 self-start lg:sticky lg:top-6">
        <Card>
          <CardHeader className="border-b border-border/75">
            <CardTitle>Publish status</CardTitle>
            <CardDescription className="mt-2">
              Task creation waits for the signed USDC payment challenge.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 pt-6">
            <div className="grid gap-3">
              <div className="flex items-start gap-3 rounded-xl border border-border/68 bg-background/48 p-3 shadow-[var(--shadow-soft)]">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-primary/60 bg-primary text-primary-foreground">
                  <CurrentModeIcon className="size-4" />
                </span>
                <div>
                  <p className="font-sans text-sm font-semibold tracking-tight">
                    {currentMode.label}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {values.mode === 'auction'
                      ? currentAuctionType.description
                      : currentMode.createDescription}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-border/68 font-mono text-xs uppercase shadow-[var(--shadow-soft)]">
                <div className="border-r border-border/70 p-3">
                  <span className="block text-muted-foreground">Funding</span>
                  <span className="mt-1 block text-foreground">USDC</span>
                </div>
                <div className="p-3">
                  <span className="block text-muted-foreground">Network</span>
                  <span className="mt-1 block text-foreground">Wallet</span>
                </div>
              </div>
            </div>

            <div className="grid gap-3 rounded-xl border border-border/68 bg-surface/42 p-4 shadow-[var(--shadow-soft)]">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-full border border-border/68 bg-background/62 text-primary">
                  <StepIcon className="size-4" />
                </span>
                <div>
                  <p className="font-sans text-sm font-semibold tracking-tight">
                    {stepCopy[phase].label}
                  </p>
                  <p className="text-xs leading-5 text-muted-foreground">{stepCopy[phase].text}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(['payment', 'signing', 'submitting'] as PublishPhase[]).map((publishStep) => (
                  <span
                    className={cn(
                      'h-1 rounded-full bg-border',
                      (phase === publishStep ||
                        (phase === 'signing' && publishStep === 'payment') ||
                        (phase === 'submitting' &&
                          (publishStep === 'payment' || publishStep === 'signing'))) &&
                        'bg-primary'
                    )}
                    key={publishStep}
                  />
                ))}
              </div>
            </div>

            {error ? (
              <p
                className="rounded-xl border border-destructive/65 bg-destructive/10 p-3 font-mono text-sm text-destructive"
                role="alert"
              >
                {error}
              </p>
            ) : null}

            {fundingPrompt ? (
              <FundingGuard
                address={address}
                defaultAmount={fundingPrompt.defaultAmount}
                message={`Wallet has ${fundingPrompt.balanceUsdc} USDC. Add ${formatUsdcUnits(
                  fundingPrompt.shortfallBaseUnits
                )} before signing the payment authorization.`}
                onStatus={handleFundingStatus}
              >
                <p className="text-xs leading-5 text-muted-foreground">
                  Required funding is {formatUsdcUnits(fundingPrompt.requiredBaseUnits)}.
                </p>
              </FundingGuard>
            ) : null}

            {fundingNotice ? (
              <p className="rounded-xl border border-border/68 bg-background/48 p-3 text-xs leading-5 text-muted-foreground">
                {fundingNotice}
              </p>
            ) : null}

            <Button
              className="h-11 w-full"
              disabled={isSubmitting || (!walletReady && !ready)}
              onClick={walletReady ? handlePublish : handleConnectWallet}
              type="button"
            >
              {buttonLabel}
            </Button>
            {!walletReady ? (
              <p className="text-xs leading-5 text-muted-foreground">
                Connect a wallet to publish this task.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

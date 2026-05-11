'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  IconBolt,
  IconClockHour4,
  IconCoin,
  IconFileText,
  IconGavel,
  IconLock,
  IconTargetArrow,
  IconTrophy,
  IconUsers,
} from '@tabler/icons-react';
import { parseUnits } from 'viem';
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3000';

type CreateTaskFormValues = {
  auctionFloorPrice: string;
  auctionStartPrice: string;
  auctionType: string;
  bidDeadline: string;
  description: string;
  duration: string;
  maxPrice: string;
  metricDescription: string;
  metricTarget: string;
  mode: string;
  pitchDeadline: string;
  reward: string;
  stakeBps: string;
  stakeRequired: boolean;
  tags: string;
};

type Step = 'form' | 'payment' | 'signing' | 'submitting';

const taskModes = [
  {
    description: 'Open submission pool. Review completed work and select the strongest delivery.',
    icon: IconTrophy,
    label: 'Bounty',
    value: 'bounty',
  },
  {
    description:
      'One worker reserves the task before starting. Useful when duplicate work is costly.',
    icon: IconLock,
    label: 'Claim',
    value: 'claim',
  },
  {
    description: 'Workers pitch an approach first. Choose the plan before execution begins.',
    icon: IconUsers,
    label: 'Pitch',
    value: 'pitch',
  },
  {
    description: 'Set a measurable outcome and pay the first worker who reaches it.',
    icon: IconTargetArrow,
    label: 'Benchmark',
    value: 'benchmark',
  },
  {
    description: 'Let workers compete on price with open, sealed, or clock-based bidding.',
    icon: IconGavel,
    label: 'Auction',
    value: 'auction',
  },
] as const;

const auctionTypes = [
  {
    description: 'Open undercutting until the deadline. Lowest valid bid wins.',
    label: 'English',
    value: 'english',
  },
  {
    description: 'Sealed prices stay hidden until close. Lowest valid bid wins.',
    label: 'Reverse English',
    value: 'reverse_english',
  },
  {
    description: 'Price descends from your max toward a floor until someone accepts.',
    label: 'Dutch',
    value: 'dutch',
  },
  {
    description: 'Price rises from a start price until the first worker accepts.',
    label: 'Reverse Dutch',
    value: 'reverse_dutch',
  },
] as const;

const stepCopy: Record<Step, { label: string; text: string }> = {
  form: {
    label: 'Ready',
    text: 'Submit when the brief and market terms are complete.',
  },
  payment: {
    label: 'Payment terms',
    text: 'Fetching the x402 payment challenge from the backend.',
  },
  signing: {
    label: 'Signature',
    text: 'Sign the USDC authorization in your wallet. This does not require gas.',
  },
  submitting: {
    label: 'Publishing',
    text: 'Sending the signed task to the marketplace.',
  },
};

function optionalNumber(value: string) {
  return value.trim() ? Number(value) : undefined;
}

function optionalUsdcBaseUnits(value: string) {
  return value.trim() ? parseUnits(value, 6).toString() : undefined;
}

export function buildCreateTaskPayload(values: CreateTaskFormValues) {
  const payload: Record<string, unknown> = {
    description: values.description,
    duration: Number(values.duration),
    mode: values.mode,
    reward: parseUnits(values.reward, 6).toString(),
    stakeBps: Number(values.stakeBps || 0),
    stakeRequired: values.stakeRequired,
    tags: values.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
  };

  const bidDeadline = optionalNumber(values.bidDeadline);
  const pitchDeadline = optionalNumber(values.pitchDeadline);
  const maxPrice = optionalUsdcBaseUnits(values.maxPrice);
  const auctionStartPrice = optionalUsdcBaseUnits(values.auctionStartPrice);
  const auctionFloorPrice = optionalUsdcBaseUnits(values.auctionFloorPrice);

  if (bidDeadline !== undefined) payload.bidDeadline = bidDeadline;
  if (pitchDeadline !== undefined) payload.pitchDeadline = pitchDeadline;
  if (maxPrice) payload.maxPrice = maxPrice;
  if (values.metricDescription.trim()) payload.metricDescription = values.metricDescription;
  if (values.metricTarget.trim()) payload.metricTarget = values.metricTarget;
  if (values.mode === 'auction') {
    payload.auctionType = values.auctionType;
    if (auctionStartPrice) payload.auctionStartPrice = auctionStartPrice;
    if (auctionFloorPrice) payload.auctionFloorPrice = auctionFloorPrice;
  }

  return payload;
}

function randomNonce() {
  return `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}` as `0x${string}`;
}

export function CreateTaskClient() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const [mode, setMode] = useState('bounty');
  const [auctionType, setAuctionType] = useState('english');
  const [stakeRequired, setStakeRequired] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState<string | null>(null);

  const isSubmitting = step !== 'form';
  const walletReady = mounted && isConnected;

  useEffect(() => {
    setMounted(true);
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!address) return;

    const formData = new FormData(event.currentTarget);
    const body = buildCreateTaskPayload({
      auctionFloorPrice: String(formData.get('auctionFloorPrice') ?? ''),
      auctionStartPrice: String(formData.get('auctionStartPrice') ?? ''),
      auctionType: String(formData.get('auctionType') ?? 'english'),
      bidDeadline: String(formData.get('bidDeadline') ?? ''),
      description: String(formData.get('description') ?? ''),
      duration: String(formData.get('duration') ?? '72'),
      maxPrice: String(formData.get('maxPrice') ?? ''),
      metricDescription: String(formData.get('metricDescription') ?? ''),
      metricTarget: String(formData.get('metricTarget') ?? ''),
      mode: String(formData.get('mode') ?? 'bounty'),
      pitchDeadline: String(formData.get('pitchDeadline') ?? ''),
      reward: String(formData.get('reward') ?? ''),
      stakeBps: String(formData.get('stakeBps') ?? '0'),
      stakeRequired,
      tags: String(formData.get('tags') ?? ''),
    });

    setError(null);
    try {
      setStep('payment');
      const probeRes = await fetch(`${apiUrl}/api/tasks`, {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (probeRes.status !== 402) {
        throw new Error(`Expected payment challenge, got ${probeRes.status}`);
      }

      const payReq = await probeRes.json();
      const accepted = payReq.accepts?.[0];
      const eip712 = accepted?.extra?.eip712;
      if (!accepted || !eip712?.domain) {
        throw new Error('Payment challenge did not include EIP-712 terms');
      }

      setStep('signing');
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

      setStep('submitting');
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
      router.push(result.taskId ? `/dashboard/tasks/${result.taskId}` : '/dashboard/tasks');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Task creation failed');
      setStep('form');
    }
  }

  const buttonLabel =
    step === 'payment'
      ? 'Fetching payment terms'
      : step === 'signing'
        ? 'Sign payment'
        : step === 'submitting'
          ? 'Creating task'
          : walletReady
            ? 'Create task'
            : 'Connect wallet to create';

  const currentMode = taskModes.find((taskMode) => taskMode.value === mode) ?? taskModes[0];
  const currentAuctionType =
    auctionTypes.find((type) => type.value === auctionType) ?? auctionTypes[0];
  const CurrentModeIcon = currentMode.icon;
  const StepIcon = step === 'form' ? IconFileText : step === 'payment' ? IconCoin : IconBolt;

  return (
    <form className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]" onSubmit={handleSubmit}>
      <div className="grid gap-6">
        <Card>
          <CardHeader className="border-b border-border/75">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>Task brief</CardTitle>
                <CardDescription className="mt-2">
                  Write the acceptance criteria as if the worker only sees this panel.
                </CardDescription>
              </div>
              <span className="rounded-full border border-border/80 bg-surface px-2 py-1 font-mono text-[0.65rem] font-semibold uppercase text-muted-foreground">
                Required
              </span>
            </div>
          </CardHeader>
          <CardContent className="grid gap-5 pt-6">
            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                className="min-h-40 resize-y text-sm leading-6"
                id="description"
                name="description"
                placeholder="Define the goal, input materials, acceptance criteria, review process, and delivery format."
                required
              />
              <p className="text-xs leading-5 text-muted-foreground">
                Strong briefs include expected output, constraints, and what counts as done.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="reward">Reward</Label>
                <div className="relative">
                  <IconCoin className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-9 font-mono"
                    id="reward"
                    min="0.01"
                    name="reward"
                    placeholder="25.00"
                    required
                    step="0.01"
                    type="number"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="duration">Duration hours</Label>
                <div className="relative">
                  <IconClockHour4 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-9 font-mono"
                    defaultValue="72"
                    id="duration"
                    min="1"
                    name="duration"
                    required
                    type="number"
                  />
                </div>
              </div>
              <div className="grid gap-2 sm:col-span-2 lg:col-span-1">
                <Label htmlFor="tags">Tags</Label>
                <Input
                  className="font-mono"
                  id="tags"
                  name="tags"
                  placeholder="research, code, audit"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border/75">
            <CardTitle>Market mode</CardTitle>
            <CardDescription className="mt-2">
              Pick how workers compete for the reward.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 pt-6">
            <input name="mode" type="hidden" value={mode} />
            <div aria-label="Task mode" className="grid gap-3 sm:grid-cols-2" role="radiogroup">
              {taskModes.map((taskMode) => {
                const Icon = taskMode.icon;
                const selected = taskMode.value === mode;

                return (
                  <button
                    aria-checked={selected}
                    className={cn(
                      'grid min-h-32 gap-3 rounded-lg border border-border/80 bg-background/55 p-4 text-left transition-[background-color,border-color,box-shadow,transform] hover:border-primary/70 hover:bg-surface-2/55 active:translate-y-px',
                      selected &&
                        'border-primary/70 bg-primary/10 shadow-[0_14px_28px_-22px_rgb(0_0_0_/_0.85)]'
                    )}
                    key={taskMode.value}
                    onClick={() => setMode(taskMode.value)}
                    role="radio"
                    type="button"
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span
                        className={cn(
                          'flex size-9 items-center justify-center rounded-md border border-border/80 text-muted-foreground',
                          selected && 'border-primary/70 bg-primary text-primary-foreground'
                        )}
                      >
                        <Icon className="size-4" />
                      </span>
                      <span className="font-mono text-[0.65rem] uppercase text-muted-foreground">
                        {selected ? 'Selected' : 'Mode'}
                      </span>
                    </span>
                    <span>
                      <span className="block font-mono text-sm font-black uppercase">
                        {taskMode.label}
                      </span>
                      <span className="mt-2 block text-sm leading-5 text-muted-foreground">
                        {taskMode.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            {mode === 'claim' ? (
              <div className="grid gap-4 rounded-lg border border-border/80 bg-surface/50 p-4 sm:grid-cols-2">
                <label className="flex min-h-20 items-center gap-3 rounded-md border border-border/80 bg-background/60 p-4 font-mono text-sm font-semibold uppercase">
                  <input
                    checked={stakeRequired}
                    className="size-4 accent-primary"
                    name="stakeRequired"
                    onChange={(event) => setStakeRequired(event.target.checked)}
                    type="checkbox"
                  />
                  Require stake
                </label>
                <div className="grid gap-2">
                  <Label htmlFor="stakeBps">Stake bps</Label>
                  <Input
                    className="font-mono"
                    defaultValue="1000"
                    id="stakeBps"
                    min="0"
                    name="stakeBps"
                    type="number"
                  />
                </div>
              </div>
            ) : null}

            {mode === 'pitch' ? (
              <div className="grid gap-2 rounded-lg border border-border/80 bg-surface/50 p-4">
                <Label htmlFor="pitchDeadline">Pitch deadline seconds</Label>
                <Input
                  className="font-mono"
                  id="pitchDeadline"
                  min="1"
                  name="pitchDeadline"
                  placeholder="86400"
                  type="number"
                />
              </div>
            ) : null}

            {mode === 'benchmark' ? (
              <div className="grid gap-4 rounded-lg border border-border/80 bg-surface/50 p-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="metricDescription">Metric</Label>
                  <Input
                    id="metricDescription"
                    name="metricDescription"
                    placeholder="Test suite pass rate"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="metricTarget">Target</Label>
                  <Input
                    className="font-mono"
                    id="metricTarget"
                    name="metricTarget"
                    placeholder="98"
                  />
                </div>
              </div>
            ) : null}

            {mode === 'auction' ? (
              <div className="grid gap-4 rounded-lg border border-border/80 bg-surface/50 p-4">
                <input name="auctionType" type="hidden" value={auctionType} />
                <div
                  aria-label="Auction type"
                  className="grid gap-3 sm:grid-cols-2"
                  role="radiogroup"
                >
                  {auctionTypes.map((type) => {
                    const selected = type.value === auctionType;

                    return (
                      <button
                        aria-checked={selected}
                        className={cn(
                          'grid gap-2 rounded-md border border-border/80 bg-background/60 p-3 text-left transition-[background-color,border-color,transform] hover:border-primary/70 hover:bg-surface-2/55 active:translate-y-px',
                          selected && 'border-primary/70 bg-primary/10'
                        )}
                        key={type.value}
                        onClick={() => setAuctionType(type.value)}
                        role="radio"
                        type="button"
                      >
                        <span className="font-mono text-xs font-black uppercase">{type.label}</span>
                        <span className="text-xs leading-5 text-muted-foreground">
                          {type.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="maxPrice">Max price</Label>
                    <Input
                      className="font-mono"
                      id="maxPrice"
                      min="0.01"
                      name="maxPrice"
                      required
                      step="0.01"
                      type="number"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="bidDeadline">Bid deadline hours</Label>
                    <Input
                      className="font-mono"
                      id="bidDeadline"
                      min="1"
                      name="bidDeadline"
                      type="number"
                    />
                  </div>
                  {auctionType === 'dutch' ? (
                    <div className="grid gap-2">
                      <Label htmlFor="auctionFloorPrice">Floor price</Label>
                      <Input
                        className="font-mono"
                        id="auctionFloorPrice"
                        min="0.01"
                        name="auctionFloorPrice"
                        required
                        step="0.01"
                        type="number"
                      />
                    </div>
                  ) : null}
                  {auctionType === 'reverse_dutch' ? (
                    <div className="grid gap-2">
                      <Label htmlFor="auctionStartPrice">Start price</Label>
                      <Input
                        className="font-mono"
                        id="auctionStartPrice"
                        min="0.01"
                        name="auctionStartPrice"
                        required
                        step="0.01"
                        type="number"
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <aside className="grid gap-6 self-start lg:sticky lg:top-6">
        <Card>
          <CardHeader className="border-b border-border/75">
            <CardTitle>Publish summary</CardTitle>
            <CardDescription className="mt-2">
              The task is created after the payment challenge is signed.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 pt-6">
            <div className="grid gap-3">
              <div className="flex items-start gap-3 rounded-md border border-border/80 bg-background/55 p-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-primary/70 bg-primary text-primary-foreground">
                  <CurrentModeIcon className="size-4" />
                </span>
                <div>
                  <p className="font-mono text-sm font-black uppercase">{currentMode.label}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {mode === 'auction' ? currentAuctionType.description : currentMode.description}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border/80 font-mono text-xs uppercase">
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

            <div className="grid gap-3 rounded-lg border border-border/80 bg-surface/50 p-4">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-md border border-border/80 bg-background/70 text-primary">
                  <StepIcon className="size-4" />
                </span>
                <div>
                  <p className="font-mono text-sm font-black uppercase">{stepCopy[step].label}</p>
                  <p className="text-xs leading-5 text-muted-foreground">{stepCopy[step].text}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(['payment', 'signing', 'submitting'] as Step[]).map((publishStep) => (
                  <span
                    className={cn(
                      'h-1 rounded-full bg-border',
                      (step === publishStep ||
                        (step === 'signing' && publishStep === 'payment') ||
                        (step === 'submitting' &&
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
                className="rounded-md border border-destructive/70 bg-destructive/10 p-3 font-mono text-sm text-destructive"
                role="alert"
              >
                {error}
              </p>
            ) : null}

            <Button
              className="h-11 w-full active:translate-y-px"
              disabled={!walletReady || isSubmitting}
              type="submit"
            >
              {buttonLabel}
            </Button>
            {!walletReady ? (
              <p className="text-xs leading-5 text-muted-foreground">
                Connect a wallet from the header before publishing this task.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </aside>
    </form>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { IconBolt, IconClockHour4, IconCoin, IconFileText } from '@tabler/icons-react';
import { parseUnits } from 'viem';
import { useAccount, useConnect, useSignTypedData, useSwitchChain } from 'wagmi';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { auctionTypeOptions, taskModeOptions } from '@/lib/market/task-mode-config';
import { cn } from '@/lib/utils';

const apiUrl = getBrowserApiBaseUrl();

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

const stepCopy: Record<Step, { label: string; text: string }> = {
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

function optionalNumber(value: string) {
  return value.trim() ? Number(value) : undefined;
}

function optionalHoursToSeconds(value: string) {
  const hours = optionalNumber(value);
  return hours === undefined ? undefined : Math.round(hours * 3_600);
}

function optionalUsdcBaseUnits(value: string) {
  return value.trim() ? parseUnits(value, 6).toString() : undefined;
}

function percentToBps(value: string) {
  const percent = Number(value || 0);
  return Number.isFinite(percent) ? Math.round(percent * 100) : 0;
}

export function buildCreateTaskPayload(values: CreateTaskFormValues) {
  const payload: Record<string, unknown> = {
    description: values.description,
    duration: Number(values.duration),
    mode: values.mode,
    reward: parseUnits(values.reward, 6).toString(),
    stakeBps: percentToBps(values.stakeBps),
    stakeRequired: values.stakeRequired,
    tags: values.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
  };

  const bidDeadline = optionalNumber(values.bidDeadline);
  const pitchDeadline = optionalHoursToSeconds(values.pitchDeadline);
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
  const { connect, connectors } = useConnect();
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
  const firstConnector = connectors[0];

  useEffect(() => {
    setMounted(true);
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

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
    if (!address) {
      setError('Connect a wallet before publishing this task.');
      return;
    }

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

  const currentMode =
    taskModeOptions.find((taskMode) => taskMode.value === mode) ?? taskModeOptions[0];
  const currentAuctionType =
    auctionTypeOptions.find((type) => type.value === auctionType) ?? auctionTypeOptions[0];
  const CurrentModeIcon = currentMode.icon;
  const StepIcon = step === 'form' ? IconFileText : step === 'payment' ? IconCoin : IconBolt;

  function handleConnectWallet() {
    setError(null);
    if (firstConnector) {
      connect({ connector: firstConnector });
    }
  }

  return (
    <form className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]" onSubmit={handleSubmit}>
      <div className="grid gap-6">
        <Card>
          <CardHeader className="border-b border-border/75">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>Brief</CardTitle>
                <CardDescription className="mt-2">
                  Workers use this text to judge fit and completion.
                </CardDescription>
              </div>
              <Badge variant="terminal">Required</Badge>
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
                Include inputs, constraints, acceptance criteria, and delivery format.
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
            <CardTitle>Task mode</CardTitle>
            <CardDescription className="mt-2">
              Choose how a worker is selected and paid.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 pt-6">
            <input name="mode" type="hidden" value={mode} />
            <div aria-label="Task mode" className="grid gap-3 sm:grid-cols-2" role="radiogroup">
              {taskModeOptions.map((taskMode) => {
                const Icon = taskMode.icon;
                const selected = taskMode.value === mode;

                return (
                  <button
                    aria-checked={selected}
                    className={cn(
                      'grid min-h-32 gap-3 rounded-xl border border-border/68 bg-background/46 p-4 text-left shadow-[var(--shadow-soft)] transition-[background-color,border-color,box-shadow,transform] duration-300 ease-[var(--ease-premium)] hover:-translate-y-0.5 hover:border-primary/48 hover:bg-surface-2/52 active:scale-[0.99]',
                      selected && 'border-primary/56 bg-primary/10 shadow-[var(--shadow-control)]'
                    )}
                    key={taskMode.value}
                    onClick={() => setMode(taskMode.value)}
                    role="radio"
                    type="button"
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span
                        className={cn(
                          'flex size-9 items-center justify-center rounded-full border border-border/68 text-muted-foreground transition-colors',
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
                      <span className="block font-sans text-sm font-semibold tracking-tight">
                        {taskMode.label}
                      </span>
                      <span className="mt-2 block text-sm leading-5 text-muted-foreground">
                        {taskMode.createDescription}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            {mode === 'claim' ? (
              <div className="grid gap-4 rounded-xl border border-border/68 bg-surface/42 p-4 shadow-[var(--shadow-soft)] sm:grid-cols-2">
                <label className="flex min-h-20 items-center gap-3 rounded-xl border border-border/68 bg-background/52 p-4 text-sm font-semibold tracking-tight">
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
                  <Label htmlFor="stakeBps">Stake percent</Label>
                  <Input
                    className="font-mono"
                    defaultValue="10"
                    id="stakeBps"
                    max="100"
                    min="0"
                    name="stakeBps"
                    step="0.01"
                    type="number"
                  />
                  <p className="text-xs leading-5 text-muted-foreground">
                    Enter the percent of the reward a claimant must stake.
                  </p>
                </div>
              </div>
            ) : null}

            {mode === 'pitch' ? (
              <div className="grid gap-2 rounded-xl border border-border/68 bg-surface/42 p-4 shadow-[var(--shadow-soft)]">
                <Label htmlFor="pitchDeadline">Pitch deadline hours</Label>
                <Input
                  className="font-mono"
                  id="pitchDeadline"
                  min="1"
                  name="pitchDeadline"
                  placeholder="24"
                  type="number"
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  Requesters enter hours. The task API receives seconds.
                </p>
              </div>
            ) : null}

            {mode === 'benchmark' ? (
              <div className="grid gap-4 rounded-xl border border-border/68 bg-surface/42 p-4 shadow-[var(--shadow-soft)] sm:grid-cols-2">
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
              <div className="grid gap-4 rounded-xl border border-border/68 bg-surface/42 p-4 shadow-[var(--shadow-soft)]">
                <input name="auctionType" type="hidden" value={auctionType} />
                <div
                  aria-label="Auction type"
                  className="grid gap-3 sm:grid-cols-2"
                  role="radiogroup"
                >
                  {auctionTypeOptions.map((type) => {
                    const selected = type.value === auctionType;

                    return (
                      <button
                        aria-checked={selected}
                        className={cn(
                          'grid gap-2 rounded-xl border border-border/68 bg-background/52 p-3 text-left transition-[background-color,border-color,box-shadow,transform] duration-300 ease-[var(--ease-premium)] hover:-translate-y-0.5 hover:border-primary/48 hover:bg-surface-2/52 active:scale-[0.99]',
                          selected &&
                            'border-primary/56 bg-primary/10 shadow-[var(--shadow-control)]'
                        )}
                        key={type.value}
                        onClick={() => setAuctionType(type.value)}
                        role="radio"
                        type="button"
                      >
                        <span className="font-sans text-xs font-semibold tracking-tight">
                          {type.label}
                        </span>
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
                    {mode === 'auction'
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
                    {stepCopy[step].label}
                  </p>
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
                className="rounded-xl border border-destructive/65 bg-destructive/10 p-3 font-mono text-sm text-destructive"
                role="alert"
              >
                {error}
              </p>
            ) : null}

            <Button
              className="h-11 w-full"
              disabled={isSubmitting || (!walletReady && !firstConnector)}
              onClick={walletReady ? undefined : handleConnectWallet}
              type={walletReady ? 'submit' : 'button'}
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
    </form>
  );
}

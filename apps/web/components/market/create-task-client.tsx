'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { parseUnits } from 'viem';
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

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
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState<string | null>(null);

  const isSubmitting = step !== 'form';

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
          : isConnected
            ? 'Create task'
            : 'Connect wallet to create';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create task</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-5" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              name="description"
              placeholder="Define acceptance criteria, inputs, and delivery format."
              required
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="reward">Reward</Label>
              <Input
                id="reward"
                min="0.01"
                name="reward"
                placeholder="25.00"
                required
                step="0.01"
                type="number"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="duration">Duration hours</Label>
              <Input
                defaultValue="72"
                id="duration"
                min="1"
                name="duration"
                required
                type="number"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="mode">Mode</Label>
              <select
                className="h-9 border border-input bg-background px-3 font-mono text-sm uppercase"
                id="mode"
                name="mode"
                onChange={(event) => setMode(event.target.value)}
                value={mode}
              >
                <option value="bounty">Bounty</option>
                <option value="claim">Claim</option>
                <option value="pitch">Pitch</option>
                <option value="benchmark">Benchmark</option>
                <option value="auction">Auction</option>
              </select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tags">Tags</Label>
            <Input id="tags" name="tags" placeholder="research, code, audit" />
          </div>
          {mode === 'claim' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex items-center gap-2 font-mono text-sm uppercase">
                <input
                  checked={stakeRequired}
                  name="stakeRequired"
                  onChange={(event) => setStakeRequired(event.target.checked)}
                  type="checkbox"
                />
                Require stake
              </label>
              <div className="grid gap-2">
                <Label htmlFor="stakeBps">Stake bps</Label>
                <Input defaultValue="1000" id="stakeBps" min="0" name="stakeBps" type="number" />
              </div>
            </div>
          ) : null}
          {mode === 'pitch' ? (
            <div className="grid gap-2">
              <Label htmlFor="pitchDeadline">Pitch deadline seconds</Label>
              <Input id="pitchDeadline" min="1" name="pitchDeadline" type="number" />
            </div>
          ) : null}
          {mode === 'benchmark' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="metricDescription">Metric</Label>
                <Input id="metricDescription" name="metricDescription" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="metricTarget">Target</Label>
                <Input id="metricTarget" name="metricTarget" />
              </div>
            </div>
          ) : null}
          {mode === 'auction' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="auctionType">Auction type</Label>
                <select
                  className="h-9 border border-input bg-background px-3 font-mono text-sm uppercase"
                  id="auctionType"
                  name="auctionType"
                  onChange={(event) => setAuctionType(event.target.value)}
                  value={auctionType}
                >
                  <option value="english">English</option>
                  <option value="reverse_english">Reverse English</option>
                  <option value="dutch">Dutch</option>
                  <option value="reverse_dutch">Reverse Dutch</option>
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="maxPrice">Max price</Label>
                <Input
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
                <Input id="bidDeadline" min="1" name="bidDeadline" type="number" />
              </div>
              {auctionType === 'dutch' ? (
                <div className="grid gap-2">
                  <Label htmlFor="auctionFloorPrice">Floor price</Label>
                  <Input
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
          ) : null}
          {error ? (
            <p className="font-mono text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button disabled={!isConnected || isSubmitting} type="submit">
            {buttonLabel}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

'use client';

import { CircleCheckIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { explorerTxUrl } from '@/lib/explorer';
import { payX402Post, type X402Step } from '@/lib/x402-client';

import { ConnectPrompt } from './connect-prompt';
import type { TaskActionComponentProps } from './types';

function currentRewardUsdc(rewardBase: string): string {
  return (Number(rewardBase) / 1_000_000).toFixed(3);
}

export function UpdateForm({ disabled, onSuccess, task }: TaskActionComponentProps) {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const [rewardUsdc, setRewardUsdc] = useState<string>(currentRewardUsdc(task.reward));
  const [extendHours, setExtendHours] = useState<string>('');
  const [bidExtendHours, setBidExtendHours] = useState<string>('');
  const [pitchExtendHours, setPitchExtendHours] = useState<string>('');
  const [description, setDescription] = useState<string>(task.description ?? '');
  const [tagsCsv, setTagsCsv] = useState<string>(task.tags.join(', '));
  const [step, setStep] = useState<X402Step | 'done' | 'idle'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [txHash, setTxHash] = useState<string | null>(null);

  if (!isConnected || !address) {
    return <ConnectPrompt label="Connect the requester wallet to update this task." />;
  }

  const auctionBidCount = (task as { auctionBidCount?: number }).auctionBidCount ?? 0;
  const auctionLocked = task.mode === 'auction' && auctionBidCount > 0;
  const busy = step !== 'idle' && step !== 'done';

  async function handleUpdate() {
    setError(null);
    setFieldErrors({});

    const body: Record<string, unknown> = { taskId: task.id };
    const errors: Record<string, string> = {};

    // reward
    const rewardNum = Number(rewardUsdc);
    if (!Number.isFinite(rewardNum) || rewardNum < 0) {
      errors.reward = 'Reward must be a non-negative USDC amount';
    } else {
      const rewardBase = Math.floor(rewardNum * 1_000_000).toString();
      if (rewardBase !== task.reward) body.reward = rewardBase;
    }

    // expiry - convert hours-from-current-expiry to absolute seconds
    const currentExpirySec = Math.floor(new Date(task.expiryTime).getTime() / 1000);
    if (extendHours.trim().length > 0) {
      const hrs = Number(extendHours);
      if (!Number.isFinite(hrs) || hrs <= 0) {
        errors.extendHours = 'Must be a positive number of hours';
      } else {
        body.expiryTime = currentExpirySec + Math.floor(hrs * 3600);
      }
    }

    // mode-aware deadlines
    if (task.mode === 'pitch' && pitchExtendHours.trim().length > 0) {
      const hrs = Number(pitchExtendHours);
      const currentPitchSec = (task as { pitchDeadline?: string | null }).pitchDeadline
        ? Math.floor(new Date((task as { pitchDeadline: string }).pitchDeadline).getTime() / 1000)
        : currentExpirySec;
      if (!Number.isFinite(hrs) || hrs <= 0) {
        errors.pitchExtendHours = 'Must be a positive number of hours';
      } else {
        body.pitchDeadline = currentPitchSec + Math.floor(hrs * 3600);
      }
    }

    if (task.mode === 'auction' && bidExtendHours.trim().length > 0) {
      if (auctionLocked) {
        errors.bidExtendHours = 'Cannot change bid deadline after bids have been placed';
      } else {
        const hrs = Number(bidExtendHours);
        const currentBidSec = (task as { bidDeadline?: string | null }).bidDeadline
          ? Math.floor(new Date((task as { bidDeadline: string }).bidDeadline).getTime() / 1000)
          : currentExpirySec;
        if (!Number.isFinite(hrs) || hrs <= 0) {
          errors.bidExtendHours = 'Must be a positive number of hours';
        } else {
          body.bidDeadline = currentBidSec + Math.floor(hrs * 3600);
        }
      }
    }

    // description & tags
    if (description.trim() !== (task.description ?? '').trim()) {
      body.description = description.trim();
    }
    const cleanedTags = tagsCsv
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (JSON.stringify(cleanedTags) !== JSON.stringify(task.tags)) {
      body.tags = cleanedTags;
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    if (Object.keys(body).length === 1) {
      setError('Nothing to update - change at least one field.');
      return;
    }

    const result = await payX402Post<{ txHash?: string }>(
      `/api/tasks/${task.id}/update`,
      body,
      { address: address!, apiUrl: getBrowserApiBaseUrl(), signTypedDataAsync, switchChainAsync },
      setStep
    );
    if (result.ok) {
      setStep('done');
      setTxHash(result.txHash ?? null);
      onSuccess?.();
      const url = result.txHash ? explorerTxUrl(result.txHash) : null;
      toast.success(
        'Updated',
        url
          ? { action: { label: 'View on explorer', onClick: () => window.open(url, '_blank') } }
          : undefined
      );
    } else {
      setStep('idle');
      if (!result.rejected) {
        setError(result.error);
        toast.error(result.error);
      }
    }
  }

  if (step === 'done') {
    const url = txHash ? explorerTxUrl(txHash) : null;
    return (
      <div className="grid gap-1 text-sm">
        <span className="flex items-center gap-1.5 font-mono text-primary">
          <CircleCheckIcon aria-hidden="true" className="size-4" />
          Updated
        </span>
        {url ? (
          <a
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            href={url}
            rel="noreferrer"
            target="_blank"
          >
            View on explorer
          </a>
        ) : null}
      </div>
    );
  }

  const label =
    step === 'payment'
      ? 'Fetching payment...'
      : step === 'signing'
        ? 'Sign payment...'
        : step === 'submitting'
          ? 'Updating...'
          : 'Update task';

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="update-reward">Reward (USDC)</Label>
        <Input
          aria-describedby={fieldErrors.reward ? 'update-reward-error' : undefined}
          aria-invalid={Boolean(fieldErrors.reward)}
          id="update-reward"
          inputMode="decimal"
          onChange={(e) => setRewardUsdc(e.currentTarget.value)}
          type="text"
          value={rewardUsdc}
        />
        {fieldErrors.reward ? (
          <p className="text-xs text-destructive" id="update-reward-error">
            {fieldErrors.reward}
          </p>
        ) : null}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="extend-hours">Extend deadline (hours, optional)</Label>
        <Input
          aria-describedby={fieldErrors.extendHours ? 'extend-hours-error' : undefined}
          aria-invalid={Boolean(fieldErrors.extendHours)}
          id="extend-hours"
          inputMode="decimal"
          onChange={(e) => setExtendHours(e.currentTarget.value)}
          placeholder="e.g. 24"
          type="text"
          value={extendHours}
        />
        {fieldErrors.extendHours ? (
          <p className="text-xs text-destructive" id="extend-hours-error">
            {fieldErrors.extendHours}
          </p>
        ) : null}
        <p className="text-xs leading-5 text-muted-foreground">
          Current expiry:{' '}
          {new Date(task.expiryTime).toLocaleString(undefined, { timeZoneName: 'short' })}
        </p>
      </div>
      {task.mode === 'pitch' ? (
        <div className="grid gap-2">
          <Label htmlFor="pitch-extend-hours">Extend pitch deadline (hours, optional)</Label>
          <Input
            aria-describedby={fieldErrors.pitchExtendHours ? 'pitch-extend-hours-error' : undefined}
            aria-invalid={Boolean(fieldErrors.pitchExtendHours)}
            id="pitch-extend-hours"
            inputMode="decimal"
            onChange={(e) => setPitchExtendHours(e.currentTarget.value)}
            placeholder="e.g. 24"
            type="text"
            value={pitchExtendHours}
          />
          {fieldErrors.pitchExtendHours ? (
            <p className="text-xs text-destructive" id="pitch-extend-hours-error">
              {fieldErrors.pitchExtendHours}
            </p>
          ) : null}
        </div>
      ) : null}
      {task.mode === 'auction' ? (
        <div className="grid gap-2">
          <Label htmlFor="bid-extend-hours">Extend bid deadline (hours, optional)</Label>
          <Input
            aria-describedby={fieldErrors.bidExtendHours ? 'bid-extend-hours-error' : undefined}
            aria-invalid={Boolean(fieldErrors.bidExtendHours)}
            disabled={auctionLocked}
            id="bid-extend-hours"
            inputMode="decimal"
            onChange={(e) => setBidExtendHours(e.currentTarget.value)}
            placeholder="e.g. 24"
            type="text"
            value={bidExtendHours}
          />
          {auctionLocked ? (
            <p className="text-xs leading-5 text-muted-foreground">
              Auction has bids - bid deadline can no longer be changed.
            </p>
          ) : null}
          {fieldErrors.bidExtendHours ? (
            <p className="text-xs text-destructive" id="bid-extend-hours-error">
              {fieldErrors.bidExtendHours}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="grid gap-2">
        <Label htmlFor="update-description">Description</Label>
        <Textarea
          className="min-h-32"
          id="update-description"
          onChange={(e) => setDescription(e.currentTarget.value)}
          rows={4}
          value={description}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="update-tags">Tags (comma-separated)</Label>
        <Input
          id="update-tags"
          onChange={(e) => setTagsCsv(e.currentTarget.value)}
          placeholder="ai, summarization, copywriting"
          type="text"
          value={tagsCsv}
        />
      </div>
      <div className="flex flex-col items-start gap-3 pt-1 sm:flex-row sm:items-center">
        <Button
          className="w-fit justify-self-start px-5"
          disabled={disabled || busy}
          onClick={handleUpdate}
          size="sm"
        >
          {label}
        </Button>
        <p className="text-xs leading-5 text-muted-foreground">Costs 0.001 USDC.</p>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

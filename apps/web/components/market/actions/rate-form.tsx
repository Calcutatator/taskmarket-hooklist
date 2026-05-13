'use client';

import { useState } from 'react';
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

export function RateForm({ disabled, task }: TaskActionComponentProps) {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const [rating, setRating] = useState<number>(85);
  const [feedback, setFeedback] = useState<string>('');
  const [step, setStep] = useState<X402Step | 'done' | 'idle'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [txHash, setTxHash] = useState<string | null>(null);

  if (!isConnected || !address) {
    return <ConnectPrompt label="Connect the requester wallet to rate this worker." />;
  }

  const worker = task.worker ?? task.claimedBy;
  const busy = step !== 'idle' && step !== 'done';

  async function handleRate() {
    setError(null);
    setFieldErrors({});

    if (!worker) {
      setError('No worker on this task');
      return;
    }
    if (rating < 0 || rating > 100 || !Number.isFinite(rating)) {
      setFieldErrors({ rating: 'Rating must be between 0 and 100' });
      return;
    }

    const body: Record<string, unknown> = {
      taskId: task.id,
      worker,
      rating,
    };
    if (feedback.trim().length > 0) body.feedbackText = feedback.trim();

    const result = await payX402Post<{ txHash?: string; feedbackId?: string }>(
      `/api/tasks/${task.id}/rate`,
      body,
      { address: address!, apiUrl: getBrowserApiBaseUrl(), signTypedDataAsync, switchChainAsync },
      setStep
    );
    if (result.ok) {
      setStep('done');
      setTxHash(result.txHash ?? null);
    } else {
      setStep('idle');
      if (!result.rejected) setError(result.error);
    }
  }

  if (step === 'done') {
    const url = txHash ? explorerTxUrl(txHash) : null;
    return (
      <div className="grid gap-1 text-sm">
        <span className="font-mono text-primary">Rating recorded</span>
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
          ? 'Submitting...'
          : 'Submit rating';

  return (
    <div className="grid gap-3">
      <div className="grid gap-2 rounded-xl border border-border/60 bg-background/42 p-3 text-xs leading-5 text-muted-foreground">
        <p className="font-sans text-sm font-semibold tracking-tight text-foreground">
          Quality guide
        </p>
        <div className="grid gap-1 font-mono">
          <p>
            <span className="text-foreground">90-100</span> complete, accurate, and easy to verify
          </p>
          <p>
            <span className="text-foreground">70-89</span> usable with minor gaps
          </p>
          <p>
            <span className="text-foreground">0-69</span> incomplete, incorrect, or hard to trust
          </p>
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="rating">Rating (0-100)</Label>
        <Input
          id="rating"
          max={100}
          min={0}
          onChange={(e) => setRating(Number(e.currentTarget.value))}
          type="number"
          value={rating}
        />
        {fieldErrors.rating ? (
          <p className="text-xs text-destructive">{fieldErrors.rating}</p>
        ) : null}
      </div>
      <div className="grid gap-1">
        <Label htmlFor="feedback">Feedback (optional)</Label>
        <Textarea
          id="feedback"
          onChange={(e) => setFeedback(e.currentTarget.value)}
          placeholder="Mention accuracy, completeness, communication, and anything the next requester should know."
          rows={3}
          value={feedback}
        />
      </div>
      <Button disabled={disabled || busy} onClick={handleRate} size="sm">
        {label}
      </Button>
      <p className="text-xs text-muted-foreground">Costs 0.001 USDC. Writes ERC-8004 feedback.</p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

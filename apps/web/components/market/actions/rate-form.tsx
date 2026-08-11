'use client';

import { CircleCheckIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi';

import { InFlightWriteNotice } from '@/components/market/in-flight-write-notice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { explorerTxUrl } from '@/lib/explorer';
import { actorDisplayName } from '@/lib/format';
import { workerAgentIdFor } from '@/lib/market/worker-identity';
import { useInvalidateActionQueue } from '@/lib/use-action-queue';
import { useInFlightWrite } from '@/lib/use-in-flight-write';
import { payX402Post, type X402Step } from '@/lib/x402-client';

import { ConnectPrompt } from './connect-prompt';
import type { TaskActionComponentProps } from './types';

export function RateForm({ action, disabled, onSuccess, task }: TaskActionComponentProps) {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const invalidateActionQueue = useInvalidateActionQueue();
  const [rating, setRating] = useState<number>(85);
  const [feedback, setFeedback] = useState<string>('');
  const [step, setStep] = useState<X402Step | 'done' | 'idle'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [txHash, setTxHash] = useState<string | null>(null);
  const formId = useId();
  const inFlight = useInFlightWrite('Rating submitted, confirming');

  // Checked before every other branch, including the disconnected one: the write is already
  // out there, so this state must survive anything that would otherwise swap the surface.
  if (inFlight.state) {
    return (
      <InFlightWriteNotice
        failure={inFlight.failure}
        idempotencyKey={inFlight.state.idempotencyKey}
        stalled={inFlight.stalled}
        subject="rating"
        title="Rating submitted, confirming"
      />
    );
  }

  if (!isConnected || !address) {
    return <ConnectPrompt label="Connect the requester wallet to rate this worker." />;
  }

  const worker = action.targetWorker ?? task.primaryAward?.workerAddress ?? task.claimedBy;
  const busy = step !== 'idle' && step !== 'done';

  async function handleRate(event?: React.FormEvent) {
    event?.preventDefault();
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

    const outcome = await inFlight.submit((idempotencyKey) =>
      payX402Post<{ txHash?: string; feedbackId?: string }>(
        `/api/tasks/${task.id}/rate`,
        body,
        { address: address!, apiUrl: getBrowserApiBaseUrl(), signTypedDataAsync, switchChainAsync },
        setStep,
        idempotencyKey
      )
    );
    // Neither success nor failure, so it must not reach the error path below: that path
    // leaves the submit button live, and pressing it again is a second payment.
    if (outcome.handled) return;
    const result = outcome.result;
    if (result.ok) {
      setStep('done');
      setTxHash(result.txHash ?? null);
      onSuccess?.();
      void invalidateActionQueue();
      const url = result.txHash ? explorerTxUrl(result.txHash) : null;
      toast.success(
        'Rating recorded',
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
          Rating recorded
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
          ? 'Submitting...'
          : 'Submit rating';

  return (
    <form className="grid gap-3" onSubmit={handleRate}>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/42 px-3 py-2 text-xs">
        <span className="text-muted-foreground">Rating recipient</span>
        <span className="font-mono text-foreground" title={worker ?? undefined}>
          {worker
            ? actorDisplayName({ address: worker, agentId: workerAgentIdFor(task, worker) })
            : 'Unavailable'}
        </span>
      </div>
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
        <Label htmlFor={`${formId}-rating`}>Rating (0-100)</Label>
        <Input
          aria-describedby={fieldErrors.rating ? `${formId}-rating-error` : undefined}
          aria-invalid={Boolean(fieldErrors.rating)}
          id={`${formId}-rating`}
          max={100}
          min={0}
          onChange={(e) => setRating(Number(e.currentTarget.value))}
          type="number"
          value={rating}
        />
        {fieldErrors.rating ? (
          <p className="text-xs text-destructive" id={`${formId}-rating-error`}>
            {fieldErrors.rating}
          </p>
        ) : null}
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${formId}-feedback`}>Feedback (optional)</Label>
        <Textarea
          id={`${formId}-feedback`}
          onChange={(e) => setFeedback(e.currentTarget.value)}
          placeholder="Mention accuracy, completeness, communication, and anything the next requester should know."
          rows={3}
          value={feedback}
        />
      </div>
      <Button disabled={disabled || busy} size="sm" type="submit">
        {label}
      </Button>
      <p className="text-xs text-muted-foreground">Costs 0.001 USDC. Writes ERC-8004 feedback.</p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </form>
  );
}

'use client';

import { CircleCheckIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi';

import { InFlightWriteNotice } from '@/components/market/in-flight-write-notice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { explorerTxUrl } from '@/lib/explorer';
import { useInFlightWrite } from '@/lib/use-in-flight-write';
import { payX402Post, type X402Step } from '@/lib/x402-client';

import { ConnectPrompt } from './connect-prompt';
import type { TaskActionComponentProps } from './types';

export function PitchForm({ disabled, onSuccess, task }: TaskActionComponentProps) {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const [pitchText, setPitchText] = useState('');
  const [durationHours, setDurationHours] = useState('');
  const [step, setStep] = useState<X402Step | 'done' | 'idle'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [txHash, setTxHash] = useState<string | null>(null);
  const inFlight = useInFlightWrite('Pitch submitted, confirming');

  // Checked before every other branch, including the disconnected one: the write is already
  // out there, so this state must survive anything that would otherwise swap the surface.
  if (inFlight.state) {
    return (
      <InFlightWriteNotice
        failure={inFlight.failure}
        idempotencyKey={inFlight.state.idempotencyKey}
        stalled={inFlight.stalled}
        subject="pitch"
        title="Pitch submitted, confirming"
      />
    );
  }

  if (!isConnected || !address) {
    return <ConnectPrompt label="Connect a worker wallet to submit a pitch." />;
  }

  const busy = step !== 'idle' && step !== 'done';

  async function handlePitch() {
    setError(null);
    setFieldErrors({});
    if (pitchText.trim().length < 10) {
      setFieldErrors({ pitchText: 'Pitch must be at least 10 characters' });
      return;
    }

    const body: Record<string, unknown> = {
      taskId: task.id,
      workerAddress: address,
      pitchText: pitchText.trim(),
      signature: '0x',
    };
    if (durationHours.trim().length > 0) {
      const hrs = Number(durationHours);
      if (!Number.isFinite(hrs) || hrs <= 0) {
        setFieldErrors({ durationHours: 'Must be a positive number of hours' });
        return;
      }
      body.estimatedDuration = Math.floor(hrs * 3600);
    }

    const result = await payX402Post<{ pitchId: string; txHash?: string }>(
      `/api/tasks/${task.id}/pitches`,
      body,
      { address: address!, apiUrl: getBrowserApiBaseUrl(), signTypedDataAsync, switchChainAsync },
      setStep,
      inFlight.idempotencyKey
    );
    if (result.ok) {
      setStep('done');
      setTxHash(result.txHash ?? null);
      onSuccess?.();
      const url = result.txHash ? explorerTxUrl(result.txHash) : null;
      toast.success(
        'Pitch submitted',
        url
          ? { action: { label: 'View on explorer', onClick: () => window.open(url, '_blank') } }
          : undefined
      );
    } else {
      setStep('idle');
      // Neither success nor failure, so it must not reach the error path below: that path
      // leaves the submit button live, and pressing it again is a second payment.
      if (inFlight.capture(result)) return;
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
          Pitch submitted
        </span>
        {url ? (
          <a
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            href={url}
            rel="noreferrer"
            target="_blank"
          >
            View anchoring tx
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
          ? 'Anchoring...'
          : 'Submit pitch';

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <Label htmlFor="pitch-text">Your pitch</Label>
        <Textarea
          aria-describedby={fieldErrors.pitchText ? 'pitch-text-error' : undefined}
          aria-invalid={Boolean(fieldErrors.pitchText)}
          id="pitch-text"
          onChange={(e) => setPitchText(e.currentTarget.value)}
          placeholder="Approach, experience, deliverables"
          rows={4}
          value={pitchText}
        />
        {fieldErrors.pitchText ? (
          <p className="text-xs text-destructive" id="pitch-text-error">
            {fieldErrors.pitchText}
          </p>
        ) : null}
      </div>
      <div className="grid gap-1">
        <Label htmlFor="pitch-duration">Estimated duration (hours, optional)</Label>
        <Input
          aria-describedby={fieldErrors.durationHours ? 'pitch-duration-error' : undefined}
          aria-invalid={Boolean(fieldErrors.durationHours)}
          id="pitch-duration"
          inputMode="decimal"
          onChange={(e) => setDurationHours(e.currentTarget.value)}
          placeholder="e.g. 8"
          type="text"
          value={durationHours}
        />
        {fieldErrors.durationHours ? (
          <p className="text-xs text-destructive" id="pitch-duration-error">
            {fieldErrors.durationHours}
          </p>
        ) : null}
      </div>
      <Button disabled={disabled || busy} onClick={handlePitch} size="sm">
        {label}
      </Button>
      <p className="text-xs text-muted-foreground">
        Costs 0.001 USDC. Anchors a tamper-proof hash of your pitch on-chain.
      </p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

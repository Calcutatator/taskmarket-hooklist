'use client';

import { useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { signAndPost } from '@/lib/wallet-sign-action';

import { ConnectPrompt } from './connect-prompt';
import type { TaskActionComponentProps } from './types';

export function PitchForm({ disabled, task }: TaskActionComponentProps) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [pitchText, setPitchText] = useState('');
  const [durationHours, setDurationHours] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  if (!isConnected || !address) {
    return <ConnectPrompt label="Connect a worker wallet to submit a pitch." />;
  }

  async function handlePitch() {
    setError(null);
    setFieldErrors({});
    if (pitchText.trim().length < 10) {
      setFieldErrors({ pitchText: 'Pitch must be at least 10 characters' });
      return;
    }

    const extra: Record<string, unknown> = { pitchText: pitchText.trim() };
    if (durationHours.trim().length > 0) {
      const hrs = Number(durationHours);
      if (!Number.isFinite(hrs) || hrs <= 0) {
        setFieldErrors({ durationHours: 'Must be a positive number of hours' });
        return;
      }
      extra.estimatedDuration = Math.floor(hrs * 3600);
    }

    setPending(true);
    const result = await signAndPost<{ pitchId: string }>({
      deps: { address: address!, apiUrl: getBrowserApiBaseUrl(), signMessageAsync },
      extraBody: extra,
      path: `/api/tasks/${task.id}/pitches`,
      taskId: task.id,
      verbForMessage: 'pitch',
    });
    setPending(false);
    if (result.ok) {
      setDone(true);
    } else if (!result.rejected) {
      setError(result.error);
    }
  }

  if (done) {
    return <span className="font-mono text-sm text-primary">✓ Pitch submitted</span>;
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <Label htmlFor="pitch-text">Your pitch</Label>
        <Textarea
          id="pitch-text"
          onChange={(e) => setPitchText(e.currentTarget.value)}
          placeholder="Approach, experience, deliverables…"
          rows={4}
          value={pitchText}
        />
        {fieldErrors.pitchText ? (
          <p className="text-xs text-destructive">{fieldErrors.pitchText}</p>
        ) : null}
      </div>
      <div className="grid gap-1">
        <Label htmlFor="pitch-duration">Estimated duration (hours, optional)</Label>
        <Input
          id="pitch-duration"
          inputMode="decimal"
          onChange={(e) => setDurationHours(e.currentTarget.value)}
          placeholder="e.g. 8"
          type="text"
          value={durationHours}
        />
        {fieldErrors.durationHours ? (
          <p className="text-xs text-destructive">{fieldErrors.durationHours}</p>
        ) : null}
      </div>
      <Button disabled={disabled || pending} onClick={handlePitch} size="sm">
        {pending ? 'Submitting…' : 'Submit pitch'}
      </Button>
      <p className="text-xs text-muted-foreground">Wallet signature only. No payment needed.</p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

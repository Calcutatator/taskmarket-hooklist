'use client';

import { CircleCheckIcon } from 'lucide-react';
import { buildSelectWorkerMessage, IDEMPOTENCY_KEY_HEADER } from '@taskmarket/shared';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAccount, useSignMessage } from 'wagmi';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { InFlightWriteNotice } from '@/components/market/in-flight-write-notice';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { getLegalRequestHeaders } from '@/lib/legal-receipt';
import { isPendingTransactionMessage } from '@/lib/relayed-write-outcome';
import { useInFlightWrite } from '@/lib/use-in-flight-write';

import { ConnectPrompt } from './connect-prompt';
import type { TaskActionComponentProps } from './types';

type Pitch = {
  id: string;
  workerAddress: string;
  pitchText: string;
};

export function SelectWorkerPicker({ disabled, onSuccess, task }: TaskActionComponentProps) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [pitches, setPitches] = useState<Pitch[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const inFlight = useInFlightWrite('Worker selection submitted, confirming');

  useEffect(() => {
    if (!isConnected) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`${getBrowserApiBaseUrl()}/api/tasks/${task.id}/pitches`);
        if (!res.ok) {
          if (!cancelled) setFetchError(`Could not load pitches (${res.status})`);
          return;
        }
        const data = (await res.json()) as Pitch[];
        if (!cancelled) {
          setFetchError(null);
          setPitches(data);
        }
      } catch (err) {
        if (!cancelled)
          setFetchError(err instanceof Error ? err.message : 'Could not load pitches');
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [task.id, isConnected]);

  // Checked before every other branch, including the disconnected and pitch-loading ones: the
  // write is already out there, so a failed pitch re-fetch must not replace this state with an
  // error. Selecting a worker is relayed but unpaid, so `paid` is false.
  if (inFlight.state) {
    return (
      <InFlightWriteNotice
        failure={inFlight.failure}
        idempotencyKey={inFlight.state.idempotencyKey}
        paid={false}
        stalled={inFlight.stalled}
        subject="worker selection"
        title="Worker selection submitted, confirming"
      />
    );
  }

  if (!isConnected || !address) {
    return <ConnectPrompt label="Connect the requester wallet to select a pitch." />;
  }

  if (fetchError) {
    return <p className="text-sm text-destructive">{fetchError}</p>;
  }

  if (pitches === null) {
    return <p className="text-sm text-muted-foreground">Loading pitches...</p>;
  }

  if (pitches.length === 0) {
    return <p className="text-sm text-muted-foreground">No pitches yet.</p>;
  }

  async function handleSelect() {
    const selected = pitches!.find((p) => p.id === selectedId);
    if (!selected) {
      setError('Choose a pitch first');
      return;
    }
    setPending(true);
    setError(null);

    const message = buildSelectWorkerMessage(task.id, selected.id, selected.workerAddress);
    let signature: string;
    try {
      signature = await signMessageAsync({ message });
    } catch (err) {
      setPending(false);
      if (typeof err === 'object' && err !== null && 'code' in err && err.code === 4001) return;
      const message = err instanceof Error ? err.message : 'Signing failed';
      setError(message);
      toast.error(message);
      return;
    }

    try {
      const res = await fetch(`${getBrowserApiBaseUrl()}/api/tasks/${task.id}/pitches/select`, {
        body: JSON.stringify({
          taskId: task.id,
          pitchId: selected.id,
          workerAddress: selected.workerAddress,
          signature,
        }),
        headers: {
          'Content-Type': 'application/json',
          ...(await getLegalRequestHeaders()),
          [IDEMPOTENCY_KEY_HEADER]: inFlight.idempotencyKey,
        },
        method: 'POST',
      });
      setPending(false);
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { message?: string };
        const message = errBody.message ?? `Server error: ${res.status}`;
        // This endpoint signs a pitch-scoped message rather than the `taskmarket:<verb>:<id>`
        // form `signAndPost` builds, so it keeps its own fetch -- but it reads the in-flight
        // outcome through the same shared predicate, not a second copy of the guess. In flight
        // is neither success nor failure, so it must not reach the error path below.
        if (
          inFlight.capture({
            ok: false,
            pending: isPendingTransactionMessage(message),
            idempotencyKey: inFlight.idempotencyKey,
            error: message,
          })
        ) {
          return;
        }
        setError(message);
        toast.error(message);
        return;
      }
      setDone(true);
      onSuccess?.();
      toast.success('Worker selected');
    } catch (err) {
      setPending(false);
      const message = err instanceof Error ? err.message : 'Request failed';
      setError(message);
      toast.error(message);
    }
  }

  if (done) {
    return (
      <span className="flex items-center gap-1.5 font-mono text-sm text-primary">
        <CircleCheckIcon aria-hidden="true" className="size-4" />
        Worker selected
      </span>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <Label htmlFor="select-pitch">Choose a pitch</Label>
        <Select onValueChange={setSelectedId} value={selectedId}>
          <SelectTrigger
            aria-describedby={error ? 'select-pitch-error' : undefined}
            aria-invalid={Boolean(error)}
            id="select-pitch"
          >
            <SelectValue placeholder="Pick a worker" />
          </SelectTrigger>
          <SelectContent>
            {pitches.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.workerAddress.slice(0, 6)}...{p.workerAddress.slice(-4)} -{' '}
                {p.pitchText.slice(0, 60)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button disabled={disabled || pending || !selectedId} onClick={handleSelect} size="sm">
        {pending ? 'Confirming...' : 'Select worker'}
      </Button>
      {error ? (
        <p className="text-xs text-destructive" id="select-pitch-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

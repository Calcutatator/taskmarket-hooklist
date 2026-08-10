'use client';

import { CircleCheckIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { InFlightWriteNotice } from '@/components/market/in-flight-write-notice';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { explorerTxUrl } from '@/lib/explorer';
import { useInFlightWrite } from '@/lib/use-in-flight-write';
import { payX402Post, type X402Step } from '@/lib/x402-client';

import { ConnectPrompt } from './connect-prompt';
import type { TaskActionComponentProps } from './types';

const PROOF_TYPES = ['custom', 'eval', 'tlsn', 'zk'] as const;

export function ProofForm({ disabled, onSuccess, task }: TaskActionComponentProps) {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const [proofData, setProofData] = useState('');
  const [proofType, setProofType] = useState<string>('custom');
  const [metricValue, setMetricValue] = useState('');
  const [step, setStep] = useState<X402Step | 'done' | 'idle'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [txHash, setTxHash] = useState<string | null>(null);
  const inFlight = useInFlightWrite('Proof submitted, confirming');

  // Checked before every other branch, including the disconnected one: the write is already
  // out there, so this state must survive anything that would otherwise swap the surface.
  if (inFlight.state) {
    return (
      <InFlightWriteNotice
        failure={inFlight.failure}
        idempotencyKey={inFlight.state.idempotencyKey}
        stalled={inFlight.stalled}
        subject="proof"
        title="Proof submitted, confirming"
      />
    );
  }

  if (!isConnected || !address) {
    return <ConnectPrompt label="Connect a worker wallet to submit benchmark proof." />;
  }

  const busy = step !== 'idle' && step !== 'done';

  async function handleProof() {
    setError(null);
    setFieldErrors({});
    if (proofData.trim().length === 0) {
      setFieldErrors({ proofData: 'Proof data is required' });
      return;
    }
    if (metricValue.trim().length > 0) {
      try {
        BigInt(metricValue.trim());
      } catch {
        setFieldErrors({ metricValue: 'Must be a non-negative integer' });
        return;
      }
    }

    const body: Record<string, unknown> = {
      taskId: task.id,
      workerAddress: address,
      proofData: proofData.trim(),
      proofType,
      signature: '0x',
    };
    if (metricValue.trim().length > 0) body.metricValue = metricValue.trim();

    const outcome = await inFlight.submit((idempotencyKey) =>
      payX402Post<{ proofId: string; submissionId: string; txHash?: string }>(
        `/api/tasks/${task.id}/proofs`,
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
      const url = result.txHash ? explorerTxUrl(result.txHash) : null;
      toast.success(
        'Proof submitted',
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
          Proof submitted
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
          : 'Submit proof';

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <Label htmlFor="proof-data">Proof data</Label>
        <Textarea
          aria-describedby={fieldErrors.proofData ? 'proof-data-error' : undefined}
          aria-invalid={Boolean(fieldErrors.proofData)}
          id="proof-data"
          onChange={(e) => setProofData(e.currentTarget.value)}
          placeholder="Raw proof bytes / hash / URI"
          rows={3}
          value={proofData}
        />
        {fieldErrors.proofData ? (
          <p className="text-xs text-destructive" id="proof-data-error">
            {fieldErrors.proofData}
          </p>
        ) : null}
      </div>
      <div className="grid gap-1">
        <Label htmlFor="proof-type">Proof type</Label>
        <Select onValueChange={setProofType} value={proofType}>
          <SelectTrigger id="proof-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROOF_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="proof-metric">Metric value (optional, integer)</Label>
        <Input
          aria-describedby={fieldErrors.metricValue ? 'proof-metric-error' : undefined}
          aria-invalid={Boolean(fieldErrors.metricValue)}
          id="proof-metric"
          inputMode="numeric"
          onChange={(e) => setMetricValue(e.currentTarget.value)}
          placeholder="e.g. 9500"
          type="text"
          value={metricValue}
        />
        {fieldErrors.metricValue ? (
          <p className="text-xs text-destructive" id="proof-metric-error">
            {fieldErrors.metricValue}
          </p>
        ) : null}
      </div>
      <Button disabled={disabled || busy} onClick={handleProof} size="sm">
        {label}
      </Button>
      <p className="text-xs text-muted-foreground">
        Costs 0.001 USDC. Anchors a tamper-proof hash of your proof on-chain.
      </p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

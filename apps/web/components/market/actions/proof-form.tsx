'use client';

import { useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';

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
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { signAndPost } from '@/lib/wallet-sign-action';

import { ConnectPrompt } from './connect-prompt';
import type { TaskActionComponentProps } from './types';

const PROOF_TYPES = ['custom', 'eval', 'tlsn', 'zk'] as const;

export function ProofForm({ disabled, task }: TaskActionComponentProps) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [proofData, setProofData] = useState('');
  const [proofType, setProofType] = useState<string>('custom');
  const [metricValue, setMetricValue] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  if (!isConnected || !address) {
    return <ConnectPrompt label="Connect a worker wallet to submit benchmark proof." />;
  }

  async function handleProof() {
    setError(null);
    setFieldErrors({});
    if (proofData.trim().length === 0) {
      setFieldErrors({ proofData: 'Proof data is required' });
      return;
    }

    const extra: Record<string, unknown> = { proofData: proofData.trim(), proofType };
    if (metricValue.trim().length > 0) extra.metricValue = metricValue.trim();

    setPending(true);
    const result = await signAndPost<{ proofId: string }>({
      deps: { address: address!, apiUrl: getBrowserApiBaseUrl(), signMessageAsync },
      extraBody: extra,
      path: `/api/tasks/${task.id}/proofs`,
      taskId: task.id,
      verbForMessage: 'proof',
    });
    setPending(false);
    if (result.ok) {
      setDone(true);
    } else if (!result.rejected) {
      setError(result.error);
    }
  }

  if (done) {
    return <span className="font-mono text-sm text-primary">✓ Proof submitted</span>;
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <Label htmlFor="proof-data">Proof data</Label>
        <Textarea
          id="proof-data"
          onChange={(e) => setProofData(e.currentTarget.value)}
          placeholder="Raw proof bytes / hash / URI"
          rows={3}
          value={proofData}
        />
        {fieldErrors.proofData ? (
          <p className="text-xs text-destructive">{fieldErrors.proofData}</p>
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
        <Label htmlFor="proof-metric">Metric value (optional)</Label>
        <Input
          id="proof-metric"
          onChange={(e) => setMetricValue(e.currentTarget.value)}
          placeholder="e.g. 0.93"
          type="text"
          value={metricValue}
        />
      </div>
      <Button disabled={disabled || pending} onClick={handleProof} size="sm">
        {pending ? 'Submitting…' : 'Submit proof'}
      </Button>
      <p className="text-xs text-muted-foreground">Wallet signature only. No payment needed.</p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

'use client';

import { CircleCheckIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAccount, useSignMessage } from 'wagmi';

import { Button } from '@/components/ui/button';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { getLegalRequestHeaders } from '@/lib/legal-receipt';

import { ConnectPrompt } from './connect-prompt';
import type { TaskActionComponentProps } from './types';

export function SelectWinnerButton({ disabled, onSuccess, task }: TaskActionComponentProps) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!isConnected || !address) {
    return <ConnectPrompt label="Connect the requester wallet to select the winning bid." />;
  }

  const bidDeadline = (task as { bidDeadline?: string | null }).bidDeadline;
  const remainingMs = bidDeadline ? new Date(bidDeadline).getTime() - now : null;
  const stillOpen = remainingMs !== null && remainingMs > 0;
  const countdown =
    stillOpen && remainingMs !== null
      ? `${Math.floor(remainingMs / 60000)}m ${Math.floor((remainingMs % 60000) / 1000)}s`
      : null;

  async function handleSelect() {
    setPending(true);
    setError(null);

    const message = `taskmarket:select-winner:${task.id}`;
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
      const res = await fetch(`${getBrowserApiBaseUrl()}/api/tasks/${task.id}/bids/select-winner`, {
        body: JSON.stringify({
          taskId: task.id,
          requesterAddress: address,
          signature,
        }),
        headers: { 'Content-Type': 'application/json', ...(await getLegalRequestHeaders()) },
        method: 'POST',
      });
      setPending(false);
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { message?: string };
        const message = errBody.message ?? `Server error: ${res.status}`;
        setError(message);
        toast.error(message);
        return;
      }
      setDone(true);
      onSuccess?.();
      toast.success('Winner selected');
    } catch (err) {
      setPending(false);
      const message = err instanceof Error ? err.message : 'Request failed';
      setError(message);
      toast.error(message);
    }
  }

  if (done) {
    return (
      <div className="grid gap-1 text-sm">
        <span className="flex items-center gap-1.5 font-mono text-primary">
          <CircleCheckIcon aria-hidden="true" className="size-4" />
          Winner selected
        </span>
        <p className="text-xs text-muted-foreground">
          The winning bidder can now begin work on this task.
        </p>
      </div>
    );
  }

  if (stillOpen) {
    return (
      <div className="grid gap-2">
        <Button aria-disabled disabled size="sm">
          Select winner - available in {countdown}
        </Button>
        <p className="text-xs text-muted-foreground">Available after the bid deadline passes.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <Button disabled={disabled || pending} onClick={handleSelect} size="sm">
        {pending ? 'Confirming...' : 'Select winner'}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

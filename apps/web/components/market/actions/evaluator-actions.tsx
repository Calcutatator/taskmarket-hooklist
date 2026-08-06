'use client';

import { CircleCheckIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { formatUnits, parseUnits } from 'viem';
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { explorerTxUrl } from '@/lib/explorer';
import { getLegalRequestHeaders } from '@/lib/legal-receipt';
import { useInvalidateActionQueue } from '@/lib/use-action-queue';
import { payX402Post, type X402Step } from '@/lib/x402-client';

import { ConfirmDialog } from './confirm-dialog';
import { ConnectPrompt } from './connect-prompt';
import type { TaskActionComponentProps } from './types';

const ZERO_EVIDENCE_HASH = `0x${'0'.repeat(64)}`;
const EVIDENCE_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

type AwardDraft = {
  amountUsdc: string;
  rank: string;
  worker: string;
};

type Verdict = 'approve' | 'partial' | 'reject';

function defaultAward(task: TaskActionComponentProps['task']): AwardDraft {
  const worker = task.claimedBy ?? task.primaryAward?.workerAddress ?? '';
  const evaluatorFeeBps = BigInt(task.evaluatorFeeBps ?? 0);
  const available = (BigInt(task.reward) * (10_000n - evaluatorFeeBps)) / 10_000n;
  return { amountUsdc: formatUnits(available, 6), rank: '1', worker };
}

function stepLabel(step: X402Step | 'done' | 'idle', idle: string) {
  if (step === 'payment') return 'Fetching payment...';
  if (step === 'signing') return 'Sign payment...';
  if (step === 'submitting') return 'Submitting...';
  return idle;
}

function appealWindowLabel(seconds: number | null | undefined) {
  if (!seconds) return 'the configured appeal window';
  if (seconds % 86_400 === 0) {
    const days = seconds / 86_400;
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  if (seconds % 3_600 === 0) {
    const hours = seconds / 3_600;
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  return `${seconds} seconds`;
}

function ActionSuccess({ label, txHash }: { label: string; txHash: string | null }) {
  const url = txHash ? explorerTxUrl(txHash) : null;
  return (
    <div className="grid gap-1 text-sm">
      <span className="flex items-center gap-1.5 font-mono text-primary">
        <CircleCheckIcon aria-hidden="true" className="size-4" />
        {label}
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

function SimplePaidAction({
  confirmDescription,
  confirmTitle,
  endpoint,
  idleLabel,
  successLabel,
  walletLabel,
  ...props
}: TaskActionComponentProps & {
  confirmDescription: string;
  confirmTitle: string;
  endpoint: string;
  idleLabel: string;
  successLabel: string;
  walletLabel: string;
}) {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const invalidateActionQueue = useInvalidateActionQueue();
  const [step, setStep] = useState<X402Step | 'done' | 'idle'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  if (!isConnected || !address) return <ConnectPrompt label={walletLabel} />;
  if (step === 'done') return <ActionSuccess label={successLabel} txHash={txHash} />;

  const busy = step !== 'idle';
  async function run() {
    setError(null);
    const result = await payX402Post<{ txHash?: string }>(
      `/api/tasks/${props.task.id}/${endpoint}`,
      { taskId: props.task.id },
      { address: address!, apiUrl: getBrowserApiBaseUrl(), signTypedDataAsync, switchChainAsync },
      setStep
    );
    if (!result.ok) {
      setStep('idle');
      if (!result.rejected) {
        setError(result.error);
        toast.error(result.error);
      }
      return;
    }
    setStep('done');
    setTxHash(result.txHash ?? null);
    props.onSuccess?.();
    void invalidateActionQueue();
    toast.success(successLabel);
  }

  return (
    <div className="grid gap-2">
      <ConfirmDialog
        confirmCta={idleLabel}
        description={confirmDescription}
        disabled={props.disabled || busy}
        loadingCta={stepLabel(step, idleLabel)}
        onConfirm={run}
        title={confirmTitle}
      >
        <Button disabled={props.disabled || busy} size="sm">
          {stepLabel(step, idleLabel)}
        </Button>
      </ConfirmDialog>
      <p className="text-xs text-muted-foreground">Costs 0.001 USDC.</p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function AppealButton(props: TaskActionComponentProps) {
  return (
    <SimplePaidAction
      {...props}
      confirmDescription="This costs 0.001 USDC and is irreversible. Submit before the appeal deadline; the task will move into dispute resolution and settlement will pause until a resolver decides the awards."
      confirmTitle="Appeal this verdict?"
      endpoint="appeal"
      idleLabel="Appeal verdict"
      successLabel="Verdict appealed"
      walletLabel="Connect the eligible worker wallet to appeal this verdict."
    />
  );
}

export function EvaluatorTimeoutButton(props: TaskActionComponentProps) {
  return (
    <SimplePaidAction
      {...props}
      confirmDescription="This costs 0.001 USDC and is irreversible. It is only available after the evaluator deadline and removes the overdue evaluator, returning the task to requester review without settling funds."
      confirmTitle="Use evaluator timeout?"
      endpoint="evaluator-timeout"
      idleLabel="Use evaluator timeout"
      successLabel="Evaluator timed out"
      walletLabel="Connect the requester wallet to use the evaluator timeout."
    />
  );
}

function AwardEditor({
  awards,
  error,
  onChange,
}: {
  awards: AwardDraft[];
  error?: string;
  onChange: (awards: AwardDraft[]) => void;
}) {
  const id = useId();
  return (
    <fieldset className="grid gap-3 rounded-xl border border-border/60 bg-background/42 p-3">
      <legend className="px-1 text-sm font-semibold text-foreground">Payout recipients</legend>
      {awards.map((award, index) => (
        <div className="grid gap-2 rounded-lg border border-border/52 p-3" key={`${id}-${index}`}>
          <div className="grid gap-1">
            <Label htmlFor={`${id}-worker-${index}`}>Worker address</Label>
            <Input
              id={`${id}-worker-${index}`}
              onChange={(event) =>
                onChange(
                  awards.map((candidate, candidateIndex) =>
                    candidateIndex === index
                      ? { ...candidate, worker: event.currentTarget.value }
                      : candidate
                  )
                )
              }
              placeholder="0x..."
              value={award.worker}
            />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
            <div className="grid gap-1">
              <Label htmlFor={`${id}-amount-${index}`}>Award amount (USDC)</Label>
              <Input
                id={`${id}-amount-${index}`}
                inputMode="decimal"
                onChange={(event) =>
                  onChange(
                    awards.map((candidate, candidateIndex) =>
                      candidateIndex === index
                        ? { ...candidate, amountUsdc: event.currentTarget.value }
                        : candidate
                    )
                  )
                }
                value={award.amountUsdc}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`${id}-rank-${index}`}>Rank</Label>
              <Input
                id={`${id}-rank-${index}`}
                min={1}
                onChange={(event) =>
                  onChange(
                    awards.map((candidate, candidateIndex) =>
                      candidateIndex === index
                        ? { ...candidate, rank: event.currentTarget.value }
                        : candidate
                    )
                  )
                }
                type="number"
                value={award.rank}
              />
            </div>
          </div>
          {awards.length > 1 ? (
            <Button
              aria-label={`Remove recipient ${index + 1}`}
              onClick={() =>
                onChange(awards.filter((_, candidateIndex) => candidateIndex !== index))
              }
              size="sm"
              type="button"
              variant="ghost"
            >
              <Trash2Icon aria-hidden="true" className="size-4" />
              Remove recipient
            </Button>
          ) : null}
        </div>
      ))}
      <Button
        onClick={() =>
          onChange([...awards, { amountUsdc: '', rank: String(awards.length + 1), worker: '' }])
        }
        size="sm"
        type="button"
        variant="outline"
      >
        <PlusIcon aria-hidden="true" className="size-4" />
        Add recipient
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </fieldset>
  );
}

function parseAwards(
  awards: AwardDraft[],
  task: TaskActionComponentProps['task']
): { error: string } | { value: Array<{ amount: string; rank: number; worker: string }> } {
  const workers = new Set<string>();
  const ranks = new Set<number>();
  const value: Array<{ amount: string; rank: number; worker: string }> = [];
  let total = 0n;

  for (const award of awards) {
    if (!ADDRESS_PATTERN.test(award.worker)) return { error: 'Enter a valid worker address.' };
    const normalizedWorker = award.worker.toLowerCase();
    if (workers.has(normalizedWorker)) return { error: 'Each award recipient must be unique.' };
    workers.add(normalizedWorker);

    const rank = Number(award.rank);
    if (!Number.isInteger(rank) || rank < 1)
      return { error: 'Each rank must be a positive integer.' };
    if (ranks.has(rank)) return { error: 'Each award rank must be unique.' };
    ranks.add(rank);

    let amount: bigint;
    try {
      amount = parseUnits(award.amountUsdc, 6);
    } catch {
      return { error: 'Enter each award amount in USDC with at most 6 decimal places.' };
    }
    if (amount <= 0n) return { error: 'Each award amount must be greater than zero.' };
    total += amount;
    value.push({ amount: amount.toString(), rank, worker: award.worker });
  }

  const evaluatorFeeBps = BigInt(task.evaluatorFeeBps ?? 0);
  const available = (BigInt(task.reward) * (10_000n - evaluatorFeeBps)) / 10_000n;
  if (total > available) {
    return { error: `Awards cannot exceed ${formatUnits(available, 6)} USDC.` };
  }
  return { value };
}

function VerdictForm({
  allowReject,
  endpoint,
  idleLabel,
  successLabel,
  ...props
}: TaskActionComponentProps & {
  allowReject: boolean;
  endpoint: 'evaluate' | 'resolve-dispute';
  idleLabel: string;
  successLabel: string;
}) {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const invalidateActionQueue = useInvalidateActionQueue();
  const [verdict, setVerdict] = useState<Verdict>('approve');
  const [score, setScore] = useState('1000');
  const [confidence, setConfidence] = useState('1000');
  const [evidenceHash, setEvidenceHash] = useState('');
  const [awards, setAwards] = useState<AwardDraft[]>([defaultAward(props.task)]);
  const [step, setStep] = useState<X402Step | 'done' | 'idle'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [awardError, setAwardError] = useState<string | undefined>();
  const [txHash, setTxHash] = useState<string | null>(null);
  const formId = useId();

  if (!isConnected || !address) {
    return <ConnectPrompt label="Connect the assigned decision-maker wallet to continue." />;
  }
  if (step === 'done') return <ActionSuccess label={successLabel} txHash={txHash} />;

  async function submit() {
    setError(null);
    setAwardError(undefined);

    const parsedScore = Number(score);
    const parsedConfidence = Number(confidence);
    if (
      !Number.isInteger(parsedScore) ||
      parsedScore < 0 ||
      parsedScore > 1000 ||
      !Number.isInteger(parsedConfidence) ||
      parsedConfidence < 0 ||
      parsedConfidence > 1000
    ) {
      setError('Score and confidence must be whole numbers from 0 to 1000.');
      return;
    }
    if (endpoint === 'evaluate') {
      if (!evidenceHash || evidenceHash === ZERO_EVIDENCE_HASH) {
        setError('Evidence hash is required and cannot be the zero hash.');
        return;
      }
      if (!EVIDENCE_HASH_PATTERN.test(evidenceHash)) {
        setError('Evidence hash must be a 32-byte 0x-prefixed hex value.');
        return;
      }
    }

    const includeAwards = endpoint === 'resolve-dispute' || verdict !== 'reject';
    const parsedAwards = includeAwards ? parseAwards(awards, props.task) : { value: [] };
    if ('error' in parsedAwards) {
      setAwardError(parsedAwards.error);
      return;
    }

    const body: Record<string, unknown> = {
      taskId: props.task.id,
      verdict,
      awards: parsedAwards.value,
    };
    if (endpoint === 'evaluate') {
      body.score = parsedScore;
      body.confidence = parsedConfidence;
      body.evidenceHash = evidenceHash;
    }

    const result = await payX402Post<{ txHash?: string }>(
      `/api/tasks/${props.task.id}/${endpoint}`,
      body,
      { address: address!, apiUrl: getBrowserApiBaseUrl(), signTypedDataAsync, switchChainAsync },
      setStep
    );
    if (!result.ok) {
      setStep('idle');
      if (!result.rejected) {
        setError(result.error);
        toast.error(result.error);
      }
      return;
    }
    setStep('done');
    setTxHash(result.txHash ?? null);
    props.onSuccess?.();
    void invalidateActionQueue();
    toast.success(successLabel);
  }

  const busy = step !== 'idle';
  const confirmationDescription =
    endpoint === 'evaluate'
      ? `This costs 0.001 USDC and is irreversible. It opens an appeal window for ${appealWindowLabel(props.task.appealWindow)}; finalization then settles the listed awards, while a rejected verdict refunds the requester.`
      : 'This costs 0.001 USDC and is irreversible. It immediately settles the listed awards, closes the dispute, and opens no further appeal window.';
  return (
    <form className="grid gap-3" onSubmit={(event) => event.preventDefault()}>
      <div className="grid gap-1">
        <Label htmlFor={`${formId}-verdict`}>Verdict</Label>
        <NativeSelect
          id={`${formId}-verdict`}
          onChange={(event) => setVerdict(event.currentTarget.value as Verdict)}
          value={verdict}
        >
          <option value="approve">Approve</option>
          <option value="partial">Partial payout</option>
          {allowReject ? <option value="reject">Reject</option> : null}
        </NativeSelect>
      </div>
      {endpoint === 'evaluate' ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label htmlFor={`${formId}-score`}>Score (0-1000)</Label>
              <Input
                id={`${formId}-score`}
                max={1000}
                min={0}
                onChange={(event) => setScore(event.currentTarget.value)}
                type="number"
                value={score}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`${formId}-confidence`}>Confidence (0-1000)</Label>
              <Input
                id={`${formId}-confidence`}
                max={1000}
                min={0}
                onChange={(event) => setConfidence(event.currentTarget.value)}
                type="number"
                value={confidence}
              />
            </div>
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`${formId}-evidence`}>Evidence hash</Label>
            <Input
              id={`${formId}-evidence`}
              onChange={(event) => setEvidenceHash(event.currentTarget.value)}
              placeholder="0x followed by 64 hexadecimal characters"
              value={evidenceHash}
            />
          </div>
        </>
      ) : null}
      {endpoint === 'resolve-dispute' || verdict !== 'reject' ? (
        <AwardEditor awards={awards} error={awardError} onChange={setAwards} />
      ) : (
        <p className="text-xs text-muted-foreground">A rejected verdict returns no worker award.</p>
      )}
      <ConfirmDialog
        confirmCta={idleLabel}
        description={confirmationDescription}
        disabled={props.disabled || busy}
        loadingCta={stepLabel(step, idleLabel)}
        onConfirm={submit}
        title={endpoint === 'evaluate' ? 'Submit this evaluation?' : 'Resolve this dispute?'}
      >
        <Button disabled={props.disabled || busy} size="sm" type="button">
          {stepLabel(step, idleLabel)}
        </Button>
      </ConfirmDialog>
      <p className="text-xs text-muted-foreground">
        Review the visible submissions before signing. Awards are final and cost 0.001 USDC.
      </p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </form>
  );
}

export function EvaluateButton(props: TaskActionComponentProps) {
  return (
    <VerdictForm
      {...props}
      allowReject
      endpoint="evaluate"
      idleLabel="Submit evaluation"
      successLabel="Evaluation submitted"
    />
  );
}

export function ResolveDisputeButton(props: TaskActionComponentProps) {
  return (
    <VerdictForm
      {...props}
      allowReject={false}
      endpoint="resolve-dispute"
      idleLabel="Resolve dispute"
      successLabel="Dispute resolved"
    />
  );
}

export function FinalizeVerdictButton(props: TaskActionComponentProps) {
  const invalidateActionQueue = useInvalidateActionQueue();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  async function finalize() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `${getBrowserApiBaseUrl()}/api/tasks/${props.task.id}/finalize-verdict`,
        {
          body: JSON.stringify({ taskId: props.task.id }),
          headers: { 'Content-Type': 'application/json', ...(await getLegalRequestHeaders()) },
          method: 'POST',
        }
      );
      const result = (await response.json().catch(() => ({}))) as {
        message?: string;
        txHash?: string;
      };
      if (!response.ok) throw new Error(result.message ?? `Server error: ${response.status}`);
      setDone(true);
      setTxHash(result.txHash ?? null);
      props.onSuccess?.();
      void invalidateActionQueue();
      toast.success('Verdict finalized');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unable to finalize the verdict';
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  if (done) return <ActionSuccess label="Verdict finalized" txHash={txHash} />;
  return (
    <div className="grid gap-2">
      <ConfirmDialog
        confirmCta="Finalize verdict"
        description="No X402 payment is required. This is irreversible and is only available after the appeal deadline; it settles the evaluator awards, or refunds the requester when the verdict rejected the work."
        disabled={props.disabled || pending}
        loadingCta="Finalizing..."
        onConfirm={finalize}
        title="Finalize this verdict?"
      >
        <Button disabled={props.disabled || pending} size="sm">
          {pending ? 'Finalizing...' : 'Finalize verdict'}
        </Button>
      </ConfirmDialog>
      <p className="text-xs text-muted-foreground">
        Finalizes the evaluator verdict after the appeal deadline. No X402 payment is required.
      </p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

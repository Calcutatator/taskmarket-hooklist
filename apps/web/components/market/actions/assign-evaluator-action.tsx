'use client';

import type { TaskDetailResponse, TaskResponse } from '@taskmarket/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi';

import { TaskEvaluationSection } from '@/components/market/task-evaluation-section';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { newIdempotencyKey } from '@/lib/api/idempotency';
import { payX402Post, type X402Step } from '@/lib/x402-client';

import { ConfirmDialog } from './confirm-dialog';

const POLL_INTERVAL_MS = 5000;
// Two minutes of polling. Past that the honest answer is "still not settled", not a longer
// wait dressed up as progress -- and never a retry button, because a retry is a second
// payment rather than a second attempt (ADR-0049 point 4).
const MAX_POLLS = 24;

function sameAddress(left?: string | null, right?: string | null) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

/**
 * Whether the connected viewer can appoint an evaluator on this task.
 *
 * Mirrors what the endpoint enforces server-side, and what the contract enforces under that:
 * `EvaluatorFacet.assignEvaluator` reverts with `TaskNotOpen` once the task leaves `open`, so
 * a claimed task can never take an evaluator (ADR-0047). Failing any condition hides the
 * control rather than showing one that cannot work.
 */
export function canAssignEvaluator(
  task: TaskDetailResponse | TaskResponse,
  viewer?: string | null
): boolean {
  return (
    sameAddress(viewer, task.requester) &&
    task.status === 'open' &&
    !task.claimedBy &&
    // Both, not just `evaluator`: a task carrying only a dispute resolver already shows the
    // appointed-terms card, and rendering the invite beside it would offer to configure
    // something the task has partly got. Kept inline rather than importing
    // `hasEvaluationTerms` so this client leaf does not pull the card's imports with it.
    !task.evaluator &&
    !task.disputeResolver
  );
}

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

/**
 * The in-flight outcome of an appointment (ADR-0049 point 3).
 *
 * Says exactly one thing: the write was submitted and no terminal outcome has been
 * established. It deliberately claims neither success nor failure -- an unconfirmed result is
 * evidence of neither -- and it offers no retry, because a retry here is a second x402
 * payment rather than a second attempt. The idempotency key is shown because it is the handle
 * that outlives the request and identifies the write to support.
 *
 * Exported so the state is reviewable on its own, without driving a wallet signature.
 */
export function EvaluatorAppointmentInFlight({
  className,
  idempotencyKey,
  stalled,
}: {
  className?: string;
  idempotencyKey: string;
  stalled?: boolean;
}) {
  return (
    <TaskEvaluationSection className={className}>
      <div
        aria-live="polite"
        className="grid gap-2 rounded-md border border-border/58 bg-card/38 p-4"
      >
        <p className="flex items-center gap-2 font-mono text-sm text-foreground">
          <span
            aria-hidden="true"
            className="size-2 rounded-full bg-primary motion-safe:animate-pulse"
          />
          Appointment submitted, confirming
        </p>
        <p className="text-xs leading-5 text-muted-foreground">
          The appointment was submitted and has not been confirmed on chain yet. This is not a
          success and not a failure: nothing is settled either way until the chain says so. It is
          being watched automatically, so do not submit again -- a second submission is a second
          payment, not a retry.
        </p>
        <p className="break-all font-mono text-[0.68rem] uppercase text-muted-foreground">
          Reference {idempotencyKey}
        </p>
        {stalled ? (
          <p className="text-xs leading-5 text-muted-foreground">
            Still not settled. Reload this page later, or quote the reference above to support. Do
            not submit the appointment again.
          </p>
        ) : null}
      </div>
    </TaskEvaluationSection>
  );
}

export function AssignEvaluatorAction({
  className,
  task,
}: {
  className?: string;
  task: TaskDetailResponse | TaskResponse;
}) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();

  const [evaluator, setEvaluator] = useState('');
  const [disputeResolver, setDisputeResolver] = useState('');
  const [feePercent, setFeePercent] = useState('5');
  const [evaluationWindowHours, setEvaluationWindowHours] = useState('24');
  const [appealWindowHours, setAppealWindowHours] = useState('24');

  const [step, setStep] = useState<X402Step | 'idle'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [inFlight, setInFlight] = useState<{ idempotencyKey: string } | null>(null);
  const [pollsExhausted, setPollsExhausted] = useState(false);

  // The key is minted once per mounted form, not per submission, so a viewer who presses the
  // button again after an ambiguous outcome presents the write the backend already has
  // instead of buying a second one (ADR-0052).
  const idempotencyKeyRef = useRef<string | null>(null);
  if (idempotencyKeyRef.current === null) {
    idempotencyKeyRef.current = newIdempotencyKey();
  }

  useEffect(() => {
    if (!inFlight) return;
    let polls = 0;
    const timer = setInterval(() => {
      polls += 1;
      if (polls > MAX_POLLS) {
        setPollsExhausted(true);
        clearInterval(timer);
        return;
      }
      // Re-reads the task on the server. The appointment is confirmed exactly when the
      // evaluator appears on the task, at which point this control stops rendering.
      router.refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [inFlight, router]);

  if (!isConnected || !address || !canAssignEvaluator(task, address)) {
    return null;
  }

  const busy = step !== 'idle';

  if (inFlight) {
    return (
      <EvaluatorAppointmentInFlight
        className={className}
        idempotencyKey={inFlight.idempotencyKey}
        stalled={pollsExhausted}
      />
    );
  }

  async function handleAssign() {
    setError(null);
    const errors: Record<string, string> = {};

    const evaluatorAddress = evaluator.trim();
    if (!ADDRESS_PATTERN.test(evaluatorAddress)) {
      errors.evaluator = 'Enter a valid 0x wallet address';
    }

    const resolverAddress = disputeResolver.trim();
    if (resolverAddress.length > 0 && !ADDRESS_PATTERN.test(resolverAddress)) {
      errors.disputeResolver = 'Enter a valid 0x wallet address, or leave blank';
    }

    const percent = Number(feePercent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      errors.feePercent = 'Fee must be between 0 and 100 percent';
    }

    const evaluationHours = Number(evaluationWindowHours);
    if (!Number.isFinite(evaluationHours) || evaluationHours <= 0) {
      errors.evaluationWindowHours = 'Must be a positive number of hours';
    }

    const appealHours = Number(appealWindowHours);
    if (!Number.isFinite(appealHours) || appealHours <= 0) {
      errors.appealWindowHours = 'Must be a positive number of hours';
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    const result = await payX402Post<{ txHash?: string }>(
      `/api/tasks/${task.id}/evaluator`,
      {
        taskId: task.id,
        evaluator: evaluatorAddress,
        evaluatorFeeBps: Math.round(percent * 100),
        evaluationWindowHours: evaluationHours,
        appealWindowHours: appealHours,
        ...(resolverAddress.length > 0 ? { disputeResolver: resolverAddress } : {}),
      },
      { address: address!, apiUrl: getBrowserApiBaseUrl(), signTypedDataAsync, switchChainAsync },
      setStep,
      idempotencyKeyRef.current!
    );

    setStep('idle');

    if (result.ok) {
      toast.success('Evaluator appointed');
      router.refresh();
      return;
    }

    // Neither success nor failure. Claim exactly that, and never offer a retry.
    if (result.pending) {
      setInFlight({ idempotencyKey: result.idempotencyKey });
      toast.info('Appointment submitted, confirming');
      return;
    }

    if (!result.rejected) {
      setError(result.error);
      toast.error(result.error);
    }
  }

  return (
    <TaskEvaluationSection className={className}>
      <p className="text-sm leading-6 text-muted-foreground">
        No evaluator is appointed, so you decide whether to accept the work yourself. Appointing one
        hands that judgement to a third party for a share of the reward. It can only be done while
        the task is open and unclaimed, because it changes the terms a worker commits to.
      </p>
      <div className="grid gap-3 rounded-md border border-border/58 bg-card/38 p-4">
        <div className="grid gap-1.5">
          <Label htmlFor="assign-evaluator-address">Evaluator address</Label>
          <Input
            autoComplete="off"
            disabled={busy}
            id="assign-evaluator-address"
            onChange={(event) => setEvaluator(event.target.value)}
            placeholder="0x..."
            spellCheck={false}
            value={evaluator}
          />
          {fieldErrors.evaluator ? (
            <p className="text-xs text-destructive">{fieldErrors.evaluator}</p>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="assign-evaluator-fee">Fee (%)</Label>
            <Input
              disabled={busy}
              id="assign-evaluator-fee"
              inputMode="decimal"
              onChange={(event) => setFeePercent(event.target.value)}
              value={feePercent}
            />
            {fieldErrors.feePercent ? (
              <p className="text-xs text-destructive">{fieldErrors.feePercent}</p>
            ) : null}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="assign-evaluator-window">Evaluation window (hours)</Label>
            <Input
              disabled={busy}
              id="assign-evaluator-window"
              inputMode="numeric"
              onChange={(event) => setEvaluationWindowHours(event.target.value)}
              value={evaluationWindowHours}
            />
            {fieldErrors.evaluationWindowHours ? (
              <p className="text-xs text-destructive">{fieldErrors.evaluationWindowHours}</p>
            ) : null}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="assign-appeal-window">Appeal window (hours)</Label>
            <Input
              disabled={busy}
              id="assign-appeal-window"
              inputMode="numeric"
              onChange={(event) => setAppealWindowHours(event.target.value)}
              value={appealWindowHours}
            />
            {fieldErrors.appealWindowHours ? (
              <p className="text-xs text-destructive">{fieldErrors.appealWindowHours}</p>
            ) : null}
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="assign-dispute-resolver">Dispute resolver address (optional)</Label>
          <Input
            autoComplete="off"
            disabled={busy}
            id="assign-dispute-resolver"
            onChange={(event) => setDisputeResolver(event.target.value)}
            placeholder="0x..."
            spellCheck={false}
            value={disputeResolver}
          />
          {fieldErrors.disputeResolver ? (
            <p className="text-xs text-destructive">{fieldErrors.disputeResolver}</p>
          ) : null}
        </div>

        <ConfirmDialog
          confirmCta="Appoint evaluator"
          description={`Hand judgement of this task to ${evaluator.trim() || 'the address above'} for ${feePercent || '0'}% of the reward. This can only be done while the task is open and unclaimed, and it changes the terms a worker is deciding on.`}
          disabled={busy}
          loadingCta="Appointing..."
          onConfirm={handleAssign}
          title="Appoint an evaluator?"
        >
          <Button disabled={busy} size="sm">
            Appoint evaluator
          </Button>
        </ConfirmDialog>
        <p className="text-xs leading-5 text-muted-foreground">Costs 0.001 USDC.</p>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </TaskEvaluationSection>
  );
}

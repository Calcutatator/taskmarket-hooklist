'use client';

import type { TaskDetailResponse, TaskResponse } from '@taskmarket/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi';

import { InFlightWriteNotice } from '@/components/market/in-flight-write-notice';
import { TaskEvaluationSection } from '@/components/market/task-evaluation-section';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { useInFlightWrite } from '@/lib/use-in-flight-write';
import { payX402Post, type X402Step } from '@/lib/x402-client';

import { ConfirmDialog } from './confirm-dialog';

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
 * The in-flight outcome of an appointment, wrapped in the evaluation section so it takes the
 * place of the form it replaces.
 *
 * The notice itself is shared (`InFlightWriteNotice`) -- this state reads identically on every
 * paid surface, and the copy and structure it established are the ones they all use.
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
      <InFlightWriteNotice
        idempotencyKey={idempotencyKey}
        stalled={stalled}
        subject="appointment"
        title="Appointment submitted, confirming"
      />
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
  const inFlight = useInFlightWrite('Appointment submitted, confirming');

  if (!isConnected || !address || !canAssignEvaluator(task, address)) {
    return null;
  }

  const busy = step !== 'idle';

  // Replaces the form outright, so the error path below -- and the button that would buy a
  // second appointment -- is unreachable from here.
  if (inFlight.state) {
    return (
      <EvaluatorAppointmentInFlight
        className={className}
        idempotencyKey={inFlight.state.idempotencyKey}
        stalled={inFlight.stalled}
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
      inFlight.idempotencyKey
    );

    setStep('idle');

    if (result.ok) {
      toast.success('Evaluator appointed');
      router.refresh();
      return;
    }

    // Neither success nor failure. Claim exactly that, and never fall through to the error
    // path, which is where a retry would be offered.
    if (inFlight.capture(result)) return;

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

'use client';

import type { TaskActionComponentProps } from './types';

export function AppealButton({ disabled }: TaskActionComponentProps) {
  return (
    <p className="text-sm text-muted-foreground">
      {disabled ? 'Appeal unavailable.' : 'Appeal coming soon.'}
    </p>
  );
}

export function EvaluateButton({ disabled }: TaskActionComponentProps) {
  return (
    <p className="text-sm text-muted-foreground">
      {disabled ? 'Evaluation unavailable.' : 'Evaluation coming soon.'}
    </p>
  );
}

export function EvaluatorTimeoutButton({ disabled }: TaskActionComponentProps) {
  return (
    <p className="text-sm text-muted-foreground">
      {disabled ? 'Timeout unavailable.' : 'Evaluator timeout coming soon.'}
    </p>
  );
}

export function FinalizeVerdictButton({ disabled }: TaskActionComponentProps) {
  return (
    <p className="text-sm text-muted-foreground">
      {disabled ? 'Finalize unavailable.' : 'Finalize verdict coming soon.'}
    </p>
  );
}

export function ResolveDisputeButton({ disabled }: TaskActionComponentProps) {
  return (
    <p className="text-sm text-muted-foreground">
      {disabled ? 'Resolve unavailable.' : 'Resolve dispute coming soon.'}
    </p>
  );
}

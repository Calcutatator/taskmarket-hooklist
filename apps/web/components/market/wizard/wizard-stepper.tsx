'use client';

import { IconCheck } from '@tabler/icons-react';

import { cn } from '@/lib/utils';

type WizardStepperProps = {
  steps: { label: string }[];
  current: number;
  onStepClick: (index: number) => void;
};

export function WizardStepper({ current, onStepClick, steps }: WizardStepperProps) {
  const total = steps.length;
  const currentLabel = steps[current]?.label ?? '';

  return (
    <nav aria-label="Task creation steps">
      <ol className="hidden grid-cols-3 gap-3 sm:grid">
        {steps.map((step, index) => {
          const completed = index < current;
          const isCurrent = index === current;
          const segmentClassName =
            'flex items-center gap-3 rounded-xl border border-border/68 bg-surface/58 px-4 py-3 text-left shadow-[var(--shadow-soft)] transition-[background-color,border-color,box-shadow,transform] duration-300 ease-[var(--ease-premium)]';
          const medallion = (
            <span
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-full border border-border/68 font-mono text-xs font-semibold text-muted-foreground transition-colors',
                completed && 'border-primary/70 bg-primary text-primary-foreground',
                isCurrent && 'border-primary/70 bg-primary/12 text-primary'
              )}
            >
              {completed ? <IconCheck className="size-4" /> : String(index + 1).padStart(2, '0')}
            </span>
          );
          const text = (
            <span className="grid">
              <span className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-muted-foreground">
                Step {index + 1}
              </span>
              <span
                className={cn(
                  'font-sans text-sm font-semibold tracking-tight text-foreground',
                  isCurrent && 'text-primary'
                )}
              >
                {step.label}
              </span>
            </span>
          );

          return (
            <li key={step.label}>
              {completed ? (
                <button
                  className={cn(
                    segmentClassName,
                    'w-full hover:-translate-y-0.5 hover:border-primary/48 hover:bg-surface-2/52 active:scale-[0.99]'
                  )}
                  onClick={() => onStepClick(index)}
                  type="button"
                >
                  {medallion}
                  {text}
                </button>
              ) : (
                <span
                  aria-current={isCurrent ? 'step' : undefined}
                  className={cn(segmentClassName, isCurrent && 'border-primary/56 bg-primary/8')}
                >
                  {medallion}
                  {text}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <ol className="grid gap-3 sm:hidden">
        <li className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">
          Step {current + 1} of {total}
          <span aria-hidden="true"> . </span>
          <span className="text-foreground">{currentLabel}</span>
        </li>
        <li>
          <span aria-hidden="true" className="grid grid-cols-3 gap-2">
            {steps.map((step, index) => (
              <span
                className={cn('h-1 rounded-full bg-border', index <= current && 'bg-primary')}
                key={step.label}
              />
            ))}
          </span>
        </li>
      </ol>
    </nav>
  );
}

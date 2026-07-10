'use client';

import { CheckCircle2Icon, FileTextIcon, ImagesIcon, LockKeyholeIcon } from 'lucide-react';

import type { TryDrop } from '@/lib/try/drops';

import { TryFlow } from './try-flow';

type TryHowItWorksProps = {
  drops: readonly TryDrop[];
};

const STEPS = [
  {
    copy: 'Answer two short questions. We turn them into an editable brief.',
    icon: FileTextIcon,
    title: 'Build the brief',
  },
  {
    copy: 'Connect only when the brief is ready, then fund the fixed $1 reward.',
    icon: LockKeyholeIcon,
    title: 'Fund $1',
  },
  {
    copy: 'Independent agents make and submit different infographic options.',
    icon: ImagesIcon,
    title: 'Agents deliver',
  },
  {
    copy: 'Review the options and release payment only to the result you accept.',
    icon: CheckCircle2Icon,
    title: 'Choose the result',
  },
] as const;

export function TryHowItWorks({ drops }: TryHowItWorksProps) {
  return (
    <section
      aria-labelledby="try-how-title"
      className="scroll-mt-20 border-b border-border/58 px-4 py-16 sm:px-6 sm:py-24 lg:px-8"
      id="how-it-works"
    >
      <div className="mx-auto grid w-full max-w-7xl gap-10">
        <div className="grid gap-3">
          <p className="font-mono text-xs font-semibold uppercase text-primary">How it works</p>
          <h2
            className="max-w-3xl font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl"
            id="try-how-title"
          >
            From one sentence to a finished infographic.
          </h2>
        </div>

        <ol className="grid gap-px overflow-hidden border border-border/58 bg-border/58 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            return (
              <li
                className="grid min-h-52 content-between gap-8 bg-background p-6"
                key={step.title}
              >
                <div className="flex items-center justify-between">
                  <Icon aria-hidden="true" className="size-5 text-primary" />
                  <span className="font-mono text-xs text-muted-foreground">0{index + 1}</span>
                </div>
                <div className="grid gap-2">
                  <h3 className="text-base font-semibold text-foreground">{step.title}</h3>
                  <p className="text-sm leading-6 text-muted-foreground">{step.copy}</p>
                </div>
              </li>
            );
          })}
        </ol>

        <TryFlow drops={drops} />

        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Funds remain locked until you accept a result. If nobody delivers before the task expires,
          the $1 is refundable.
        </p>
      </div>
    </section>
  );
}

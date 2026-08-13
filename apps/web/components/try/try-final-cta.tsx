'use client';

import type { RefObject } from 'react';

import { TryTopicForm } from './try-topic-form';

type TryFinalCtaProps = {
  disabled: boolean;
  error: string | null;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onSubmit: () => void;
  value: string;
};

export function TryFinalCta({
  disabled,
  error,
  inputRef,
  onChange,
  onSubmit,
  value,
}: TryFinalCtaProps) {
  return (
    <section
      aria-labelledby="try-final-title"
      className="border-b border-border/58 bg-primary/[0.07] px-4 py-16 sm:px-6 sm:py-24 lg:px-8"
    >
      <div className="mx-auto grid w-full max-w-4xl gap-7 text-center">
        <p className="font-mono text-xs font-semibold uppercase text-primary">Make yours</p>
        <h2
          className="font-display text-3xl font-semibold leading-tight tracking-tight sm:text-5xl"
          id="try-final-title"
        >
          What should the next infographic explain?
        </h2>
        <div className="mx-auto w-full max-w-2xl text-left">
          <TryTopicForm
            disabled={disabled}
            error={error}
            id="try-topic-closing"
            inputRef={inputRef}
            onChange={onChange}
            onSubmit={onSubmit}
            value={value}
            variant="closing"
          />
        </div>
      </div>
    </section>
  );
}

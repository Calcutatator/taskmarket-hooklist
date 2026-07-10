'use client';

import type { RefObject } from 'react';

import type { TryDrop } from '@/lib/try/drops';

import { TryDropCollage } from './try-drop-collage';
import { TryTopicForm } from './try-topic-form';

type TryHeroProps = {
  drops: readonly TryDrop[];
  error: string | null;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onSubmit: () => void;
  value: string;
};

export function TryHero({ drops, error, inputRef, onChange, onSubmit, value }: TryHeroProps) {
  return (
    <section
      aria-labelledby="try-hero-title"
      className="try-hero relative isolate flex min-h-[calc(100svh-4rem)] flex-col justify-end overflow-hidden border-b border-border/58 bg-background"
    >
      <TryDropCollage drops={drops} />
      <div aria-hidden="true" className="try-hero-contrast" />

      <div className="relative z-10 mx-auto grid w-full max-w-7xl flex-1 grid-cols-[minmax(0,1fr)] content-center px-4 pb-10 pt-28 sm:px-6 sm:pb-14 lg:px-8">
        <div className="grid max-w-2xl gap-6">
          <p className="flex items-center gap-3 font-mono text-xs font-semibold uppercase text-primary">
            <span aria-hidden="true" className="h-px w-8 bg-primary" />
            Made on Taskmarket
          </p>
          <h1
            className="max-w-2xl font-display text-5xl font-semibold leading-[0.96] tracking-tight text-foreground sm:text-6xl lg:text-7xl"
            id="try-hero-title"
          >
            A custom infographic for $1.
          </h1>
          <p className="max-w-xl text-lg leading-8 text-foreground/82">
            Tell us what it should explain. Agents make the options; you choose the result to
            accept.
          </p>
          <div className="mt-1 max-w-2xl">
            <TryTopicForm
              error={error}
              id="try-topic"
              inputRef={inputRef}
              onChange={onChange}
              onSubmit={onSubmit}
              value={value}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

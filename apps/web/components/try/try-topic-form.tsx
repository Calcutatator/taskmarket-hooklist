'use client';

import { ArrowRightIcon } from 'lucide-react';
import type { ChangeEvent, FormEvent, RefObject } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type TryTopicFormProps = {
  error: string | null;
  id: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onSubmit: () => void;
  value: string;
  variant?: 'hero' | 'closing';
};

export function TryTopicForm({
  error,
  id,
  inputRef,
  onChange,
  onSubmit,
  value,
  variant = 'hero',
}: TryTopicFormProps) {
  const errorId = `${id}-error`;

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onChange(event.target.value);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form className="grid gap-3" onSubmit={handleSubmit}>
      <Label
        className={cn(
          'font-mono text-xs font-semibold uppercase',
          variant === 'hero' ? 'text-foreground/74' : 'text-muted-foreground'
        )}
        htmlFor={id}
      >
        What should yours explain?
      </Label>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Input
          aria-describedby={error ? errorId : undefined}
          aria-invalid={Boolean(error)}
          autoComplete="off"
          className={cn(
            'h-12 min-w-0 bg-background/86 px-4 text-base shadow-[var(--shadow-elevated)] md:text-base',
            variant === 'hero' && 'border-white/22 backdrop-blur-md'
          )}
          id={id}
          maxLength={180}
          onChange={handleChange}
          placeholder="Why the cost of solar power keeps falling"
          ref={inputRef}
          value={value}
        />
        <Button className="h-12 w-full gap-2 px-5 sm:w-auto" size="lg" type="submit">
          Build my brief
          <ArrowRightIcon aria-hidden="true" className="size-4" />
        </Button>
      </div>
      {error ? (
        <p className="text-sm font-medium text-destructive" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
      {variant === 'hero' ? (
        <p className="max-w-xl text-xs leading-5 text-foreground/68">
          No account needed to start. Connect and fund only when your brief is ready.
        </p>
      ) : null}
    </form>
  );
}

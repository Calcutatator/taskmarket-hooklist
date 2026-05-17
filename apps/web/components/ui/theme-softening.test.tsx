import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

describe('softened UI primitives', () => {
  it('uses rounded, softer surfaces for shared controls', () => {
    render(
      <div>
        <Button>Primary action</Button>
        <Button asChild data-testid="active-chip" size="chip" variant="chip">
          <a data-active="true" href="/dashboard/tasks">
            Active chip
          </a>
        </Button>
        <Card data-testid="card">Panel</Card>
        <Badge>Mode</Badge>
        <Badge variant="terminal">Terminal</Badge>
        <Input aria-label="Task title" />
        <Textarea aria-label="Task brief" />
      </div>
    );

    expect(screen.getByRole('button', { name: /primary action/i })).toHaveClass(
      'rounded-full',
      'hover:-translate-y-0.5',
      'shadow-[var(--shadow-control),inset_0_1px_0_rgb(255_255_255_/_0.16)]'
    );
    expect(screen.getByRole('link', { name: /active chip/i })).toHaveClass(
      'data-[active=true]:bg-primary/12',
      'data-[active=true]:shadow-[var(--shadow-control),inset_0_1px_0_rgb(255_255_255_/_0.1)]'
    );
    expect(screen.getByTestId('card')).toHaveClass('rounded-lg', 'bg-card/44', 'shadow-none');
    expect(screen.getByTestId('card')).not.toHaveClass('shadow-[var(--shadow-elevated)]');
    expect(screen.getByText('Mode')).toHaveClass(
      'rounded-full',
      'bg-primary/10',
      'text-primary',
      'shadow-none'
    );
    expect(screen.getByText('Terminal')).toHaveClass(
      'bg-surface/52',
      'text-foreground/84',
      'shadow-none'
    );
    expect(screen.getByLabelText(/task title/i)).toHaveClass('rounded-full');
    expect(screen.getByLabelText(/task brief/i)).toHaveClass('rounded-xl');
  });
});

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
        <Card data-testid="card">Panel</Card>
        <Badge>Mode</Badge>
        <Input aria-label="Task title" />
        <Textarea aria-label="Task brief" />
      </div>
    );

    expect(screen.getByRole('button', { name: /primary action/i })).toHaveClass('rounded-full');
    expect(screen.getByTestId('card')).toHaveClass('rounded-xl', 'shadow-[var(--shadow-elevated)]');
    expect(screen.getByText('Mode')).toHaveClass('rounded-full');
    expect(screen.getByLabelText(/task title/i)).toHaveClass('rounded-full');
    expect(screen.getByLabelText(/task brief/i)).toHaveClass('rounded-xl');
  });
});

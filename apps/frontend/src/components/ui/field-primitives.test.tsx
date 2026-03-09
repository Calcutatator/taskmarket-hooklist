import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Input } from './input';
import { NativeSelect } from './native-select';
import { Select, SelectTrigger, SelectValue } from './select';
import { Textarea } from './textarea';

describe('field primitives', () => {
  it('renders input-like controls with the shared secondary surface styling', () => {
    render(
      <div>
        <Input aria-label="Task search" />
        <Textarea aria-label="Task description" />
        <NativeSelect aria-label="Task mode">
          <option>Bounty</option>
        </NativeSelect>
        <Select>
          <SelectTrigger aria-label="Task status">
            <SelectValue placeholder="Open" />
          </SelectTrigger>
        </Select>
      </div>
    );

    expect(screen.getByLabelText('Task search')).toHaveClass('bg-background-secondary');
    expect(screen.getByLabelText('Task description')).toHaveClass('bg-background-secondary');
    expect(screen.getByLabelText('Task mode')).toHaveClass('bg-background-secondary');
    expect(screen.getByRole('combobox', { name: 'Task status' })).toHaveClass(
      'bg-background-secondary'
    );
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TaskFilterBar } from './TaskFilterBar';

describe('TaskFilterBar', () => {
  it('renders the shared filter panel title and dirty-state action', () => {
    render(
      <TaskFilterBar
        filters={{
          mode: 'bounty',
          status: 'ALL',
          minReward: '',
          maxReward: '',
          deadlineHours: '',
          tags: '',
        }}
        onFilterChange={vi.fn()}
        onClear={vi.fn()}
      />
    );

    expect(screen.getByText('Filter tasks')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });
});

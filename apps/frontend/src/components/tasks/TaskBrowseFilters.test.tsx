import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TaskBrowseFilters } from './TaskBrowseFilters';

const filters = {
  mode: 'ALL',
  status: 'ALL',
  minReward: '',
  maxReward: '',
  deadlineHours: '',
  tags: '',
};

describe('TaskBrowseFilters', () => {
  it('renders all terminal filter groups', () => {
    render(<TaskBrowseFilters filters={filters} onFilterChange={vi.fn()} onClear={vi.fn()} />);

    expect(screen.getByText('Reward')).toBeInTheDocument();
    expect(screen.getByText('Mode')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByLabelText('Min reward')).toBeInTheDocument();
    expect(screen.getByLabelText('Tags')).toBeInTheDocument();
  });

  it('shows reset action when filters are dirty', () => {
    render(
      <TaskBrowseFilters
        filters={{ ...filters, mode: 'auction' }}
        onFilterChange={vi.fn()}
        onClear={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Reset filters' })).toBeInTheDocument();
  });
});

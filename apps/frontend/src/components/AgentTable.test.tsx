import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentTable } from './AgentTable';

describe('AgentTable', () => {
  it('renders the shared directory filter panel', () => {
    render(
      <AgentTable
        variant="directory"
        data={[]}
        isLoading={false}
        page={1}
        pageSize={20}
        sort="reputation"
        searchInput=""
        skillInput=""
        minRating={undefined}
        minTasks={undefined}
        hasNextPage={false}
        hasPrevPage={false}
        hasActiveFilters={false}
        onSearchChange={vi.fn()}
        onSkillChange={vi.fn()}
        onMinRatingChange={vi.fn()}
        onMinTasksChange={vi.fn()}
        onSortChange={vi.fn()}
        onPageSizeChange={vi.fn()}
        onPageChange={vi.fn()}
        onSearchSubmit={(e) => e.preventDefault()}
        onClearFilters={vi.fn()}
        searchPlaceholder="Search by name, ID, or address"
      />
    );

    expect(screen.getByText('Filter agents')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search by name, ID, or address')).toBeInTheDocument();
  });
});

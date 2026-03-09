import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FilterPanel } from './FilterPanel';

describe('FilterPanel', () => {
  it('renders title, description, and children', () => {
    render(
      <FilterPanel title="Filters" description="Narrow the current results.">
        <label htmlFor="query">Query</label>
        <input id="query" />
      </FilterPanel>
    );

    expect(screen.getByText('Filters')).toBeInTheDocument();
    expect(screen.getByText('Narrow the current results.')).toBeInTheDocument();
    expect(screen.getByLabelText('Query')).toBeInTheDocument();
  });
});

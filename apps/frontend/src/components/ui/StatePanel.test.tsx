import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatePanel } from './StatePanel';

describe('StatePanel', () => {
  it('renders a loading state with aria-busy', () => {
    render(
      <StatePanel title="Loading tasks" description="Fetching the latest tasks." busy>
        <div>Skeleton</div>
      </StatePanel>
    );

    expect(screen.getByText('Loading tasks')).toBeInTheDocument();
    expect(screen.getByText('Fetching the latest tasks.')).toBeInTheDocument();
    expect(screen.getByText('Loading tasks').closest('[aria-busy="true"]')).toBeInTheDocument();
  });

  it('renders error states as alerts', () => {
    render(<StatePanel title="Failed to load" tone="error" />);

    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load');
  });
});

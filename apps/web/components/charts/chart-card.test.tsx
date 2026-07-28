import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ChartCard } from './chart-card';

function renderCard(props: Partial<React.ComponentProps<typeof ChartCard>>) {
  return render(
    <ChartCard
      action={<button type="button">Last 7 days</button>}
      description="Live market activity by mode and date."
      title="Activity heat map"
      {...props}
    >
      <span>chart body</span>
    </ChartCard>
  );
}

describe('ChartCard', () => {
  it('keeps the header and its controls in the empty state', () => {
    renderCard({ isEmpty: true });

    // A range with no data must not strand the viewer: the toggle that switches
    // back to a range that does have data has to stay on screen.
    expect(screen.getByRole('button', { name: 'Last 7 days' })).toBeInTheDocument();
    expect(screen.getByText('Activity heat map')).toBeInTheDocument();
    expect(screen.getByText('Live market activity by mode and date.')).toBeInTheDocument();
    expect(screen.getByText('Nothing to chart yet')).toBeInTheDocument();
    expect(screen.queryByText('chart body')).not.toBeInTheDocument();
  });

  it('keeps the header and its controls in the error state', () => {
    renderCard({ errorMessage: 'Could not load the activity heat map.' });

    expect(screen.getByRole('button', { name: 'Last 7 days' })).toBeInTheDocument();
    expect(screen.getByText('Activity heat map')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the activity heat map.');
    expect(screen.getByRole('link', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.queryByText('chart body')).not.toBeInTheDocument();
  });

  it('reserves the description and action chrome while loading', () => {
    const { container } = renderCard({ isLoading: true });

    expect(container.querySelector('[data-slot="card-description"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="card-action"]')).not.toBeNull();
    // The control itself is not interactive yet, so only its footprint is held.
    expect(screen.queryByRole('button', { name: 'Last 7 days' })).not.toBeInTheDocument();
  });

  it('omits the description and action chrome when the card has neither', () => {
    const { container } = render(
      <ChartCard isLoading title="Your inbox">
        <span>chart body</span>
      </ChartCard>
    );

    expect(container.querySelector('[data-slot="card-description"]')).toBeNull();
    expect(container.querySelector('[data-slot="card-action"]')).toBeNull();
  });

  it('sizes the loading body from the height it was given', () => {
    const { container } = renderCard({ height: 210, isLoading: true, mobileHeight: 352 });

    const body = container.querySelector('[data-slot="card-content"] [data-slot="skeleton"]');
    expect(body).not.toBeNull();
    expect(body).toHaveStyle({
      '--chart-skeleton-height': '210px',
      '--chart-skeleton-mobile-height': '352px',
    });
  });
});

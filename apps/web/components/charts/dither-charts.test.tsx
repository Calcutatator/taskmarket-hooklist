import { render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { HistogramBars } from './bar-chart';
import { Sparkline } from './sparkline';
import { StatusBreakdown } from './status-breakdown';
import { TrendAreaChart } from './trend-area-chart';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const canvasContext = {
  clearRect: vi.fn(),
  drawImage: vi.fn(),
  fillRect: vi.fn(),
  fillStyle: '',
};

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    canvasContext as unknown as CanvasRenderingContext2D
  );
});

describe('Dither chart adapters', () => {
  it('renders a labelled area chart with an accessible data table', () => {
    const { container } = render(
      <TrendAreaChart
        ariaLabel="Marketplace activity trend"
        data={[
          { bucket: 'Jul 1', completed: 2, created: 4 },
          { bucket: 'Jul 2', completed: 3, created: 5 },
        ]}
        series={[
          { key: 'created', label: 'Tasks created' },
          { key: 'completed', label: 'Tasks completed' },
        ]}
        xKey="bucket"
      />
    );

    expect(screen.getByRole('img', { name: 'Marketplace activity trend' })).toBeInTheDocument();
    expect(container.querySelector('[data-chart-engine="dither"]')).toBeInTheDocument();

    const table = screen.getByRole('table', { name: 'Marketplace activity trend data' });
    expect(within(table).getByRole('columnheader', { name: 'Tasks created' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '5' })).toBeInTheDocument();
  });

  it('keeps null-valued trends on the gap-preserving renderer', () => {
    const { container } = render(
      <TrendAreaChart
        ariaLabel="Agent rating trend"
        data={[
          { bucket: 'Week 1', rating: 4.5 },
          { bucket: 'Week 2', rating: null },
          { bucket: 'Week 3', rating: 4.8 },
        ]}
        series={[{ key: 'rating', label: 'Rating' }]}
        xKey="bucket"
      />
    );

    expect(container.querySelector('[data-chart-engine="recharts"]')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Agent rating trend data' });
    expect(within(table).getByRole('cell', { name: 'No data' })).toBeInTheDocument();
  });

  it('renders the public sparkline contract on Dither Kit', () => {
    const { container } = render(<Sparkline ariaLabel="Tasks created trend" data={[2, 4, 3, 7]} />);

    expect(screen.getByRole('img', { name: 'Tasks created trend' })).toBeInTheDocument();
    expect(container.querySelector('[data-chart-engine="dither"]')).toBeInTheDocument();
  });

  it('renders histogram values with an accessible table', () => {
    const { container } = render(
      <HistogramBars
        ariaLabel="Ratings distribution"
        data={[
          { label: '0-20', value: 1 },
          { label: '20-40', value: 3 },
        ]}
      />
    );

    expect(container.querySelector('[data-chart-engine="dither"]')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Ratings distribution data' });
    expect(within(table).getByRole('rowheader', { name: '20-40' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '3' })).toBeInTheDocument();
  });

  it('renders a labelled dithered donut while preserving exact status values', () => {
    const { container } = render(
      <StatusBreakdown
        ariaLabel="Task status distribution"
        centerCaption="tasks"
        centerLabel="5"
        data={[
          { bucket: 'open', label: 'Open', value: 3 },
          { bucket: 'completed', label: 'Completed', value: 2 },
        ]}
      />
    );

    expect(screen.getByRole('img', { name: 'Task status distribution' })).toBeInTheDocument();
    expect(container.querySelector('[data-chart-engine="dither"]')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeVisible();

    const table = screen.getByRole('table', { name: 'Task status distribution data' });
    expect(within(table).getByRole('rowheader', { name: 'Completed' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '2' })).toBeInTheDocument();
  });
});

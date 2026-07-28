import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { HistogramBars } from './bar-chart';
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

// The chart chrome only draws once the container reports a size, and jsdom lays
// nothing out — so give the measurement hook a plot rect to read. jsdom has no
// 2D context either, so the paint is a no-op here and every assertion below
// reads the DOM, ARIA, and events rather than pixels.
const size = (property: 'clientWidth' | 'clientHeight', value: number) =>
  Object.defineProperty(HTMLElement.prototype, property, { configurable: true, value });

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    canvasContext as unknown as CanvasRenderingContext2D
  );
  size('clientWidth', 480);
  size('clientHeight', 250);
});

afterAll(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
});

const trend = (
  <TrendAreaChart
    ariaLabel="Marketplace activity trend"
    data={[
      { bucket: 'Jul 1', completed: 1, created: 4 },
      { bucket: 'Jul 2', completed: 3, created: 5 },
      { bucket: 'Jul 3', completed: 2, created: 9 },
    ]}
    series={[
      { key: 'created', label: 'Tasks created' },
      { key: 'completed', label: 'Tasks completed' },
    ]}
    xKey="bucket"
  />
);

const readout = (container: HTMLElement) => container.querySelector('[data-chart-readout]');

describe('Chart keyboard scrubbing', () => {
  it('puts the plot in the tab order and announces the first point on focus', async () => {
    const user = userEvent.setup();
    const { container } = render(trend);

    await user.tab();

    const plot = screen.getByRole('img', { name: 'Marketplace activity trend' });
    expect(plot).toHaveFocus();
    expect(plot).toHaveAttribute('tabindex', '0');
    expect(readout(container)).toHaveTextContent('Jul 1. Tasks created: 4, Tasks completed: 1');
  });

  it('describes the focused plot so the arrow keys are discoverable', () => {
    render(trend);

    const plot = screen.getByRole('img', { name: 'Marketplace activity trend' });
    const hint = document.getElementById(plot.getAttribute('aria-describedby') ?? '');
    expect(hint).toHaveTextContent(/arrow keys/i);
  });

  it('moves between points with the arrow keys and updates the announced values', async () => {
    const user = userEvent.setup();
    const { container } = render(trend);

    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(readout(container)).toHaveTextContent('Jul 2. Tasks created: 5, Tasks completed: 3');

    await user.keyboard('{ArrowRight}');
    expect(readout(container)).toHaveTextContent('Jul 3. Tasks created: 9, Tasks completed: 2');

    // Clamped at the last point rather than wrapping around to the start.
    await user.keyboard('{ArrowRight}');
    expect(readout(container)).toHaveTextContent('Jul 3. Tasks created: 9, Tasks completed: 2');

    await user.keyboard('{ArrowLeft}');
    expect(readout(container)).toHaveTextContent('Jul 2. Tasks created: 5, Tasks completed: 3');
  });

  it('jumps to the first and last point with Home and End', async () => {
    const user = userEvent.setup();
    const { container } = render(trend);

    await user.tab();
    await user.keyboard('{End}');
    expect(readout(container)).toHaveTextContent('Jul 3. Tasks created: 9, Tasks completed: 2');

    await user.keyboard('{Home}');
    expect(readout(container)).toHaveTextContent('Jul 1. Tasks created: 4, Tasks completed: 1');
  });

  it('dismisses the readout on Escape without leaving the plot', async () => {
    const user = userEvent.setup();
    const { container } = render(trend);

    await user.tab();
    await user.keyboard('{Escape}');

    expect(readout(container)).toHaveTextContent('');
    expect(screen.getByRole('img', { name: 'Marketplace activity trend' })).toHaveFocus();
  });

  it('clears the readout when focus leaves the plot', async () => {
    const user = userEvent.setup();
    const { container } = render(trend);

    await user.tab();
    expect(readout(container)).not.toHaveTextContent('');

    await user.tab();
    expect(readout(container)).toHaveTextContent('');
  });

  it('announces bar values through the chart formatter', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <HistogramBars
        ariaLabel="Ratings distribution"
        data={[
          { label: '0-20', value: 1 },
          { label: '20-40', value: 3 },
        ]}
        valueFormatter={(value) => `${value} agents`}
      />
    );

    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(readout(container)).toHaveTextContent('20-40. Count: 3 agents');
  });

  it('scrubs donut slices by keyboard without repeating the slice name', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <StatusBreakdown
        ariaLabel="Task status distribution"
        data={[
          { bucket: 'open', label: 'Open', value: 3 },
          { bucket: 'completed', label: 'Completed', value: 2 },
        ]}
      />
    );

    await user.tab();
    expect(readout(container)).toHaveTextContent('Open: 3');

    await user.keyboard('{ArrowRight}');
    expect(readout(container)).toHaveTextContent('Completed: 2');
  });

  it('leaves the accessible data table as the noninteractive equivalent', async () => {
    const user = userEvent.setup();
    render(trend);

    await user.tab();

    // The keyboard readout is additive: the full table still carries every row.
    const table = screen.getByRole('table', { name: 'Marketplace activity trend data' });
    expect(table).toBeInTheDocument();
    expect(table).toHaveTextContent('Jul 3');
  });
});

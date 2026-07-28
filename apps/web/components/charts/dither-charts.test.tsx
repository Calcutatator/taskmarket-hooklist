import { render, screen, within } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { HistogramBars } from './bar-chart';
import { Sparkline } from './sparkline';
import { StatusBreakdown } from './status-breakdown';
import { TrendAreaChart } from './trend-area-chart';
import { radialPercent, ValueRadial } from './value-radial';

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

  it('keeps null-valued trends on the one dither engine', () => {
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

    expect(container.querySelector('[data-chart-engine="dither"]')).toBeInTheDocument();
    expect(container.querySelector('[data-chart-engine="recharts"]')).not.toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Agent rating trend data' });
    expect(within(table).getByRole('cell', { name: 'No data' })).toBeInTheDocument();
  });

  it('renders the public sparkline contract on Dither Kit', () => {
    const { container } = render(<Sparkline data={[2, 4, 3, 7]} />);

    expect(container.querySelector('[data-chart-engine="dither"]')).toBeInTheDocument();
    // Decorative inside an already-labelled stat tile, so it is hidden rather
    // than announced as an image carrying no readable values.
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
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

describe('Value radial gauge', () => {
  it('renders the readout, the labelled plot, and both ring segments as text', () => {
    const { container } = render(<ValueRadial max={1000} name="Credibility" value={640} />);

    expect(screen.getByRole('img', { name: 'Credibility: 64%' })).toBeInTheDocument();
    expect(container.querySelector('[data-chart-engine="dither"]')).toBeInTheDocument();
    // The readout is a span; the table repeats the same string in a cell.
    expect(screen.getByText('64%', { selector: 'span' })).toBeVisible();

    const table = screen.getByRole('table', { name: 'Credibility: 64% data' });
    expect(within(table).getByRole('rowheader', { name: 'Credibility' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '64%' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'Remaining' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '36%' })).toBeInTheDocument();
  });

  it('keeps the centre readout out of the accessible name it duplicates', () => {
    const { container } = render(
      <ValueRadial caption="credibility" label="86.2%" max={1000} name="Score" value={862} />
    );

    expect(screen.getByRole('img', { name: 'Score: 86.2%' })).toBeInTheDocument();
    expect(screen.getByText('86.2%', { selector: 'span' })).toBeVisible();
    // Announcing the overlay as well as the plot label would say it twice.
    const overlay = container.querySelector('.inset-0.flex.flex-col');
    expect(overlay).toHaveAttribute('aria-hidden', 'true');
    expect(overlay).toHaveTextContent('credibility');
  });

  it('clamps an out-of-range value to a full ring', () => {
    render(<ValueRadial max={100} name="Coverage" value={180} />);

    expect(screen.getByRole('img', { name: 'Coverage: 100%' })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Coverage: 100% data' });
    expect(within(table).getByRole('cell', { name: '100%' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '0%' })).toBeInTheDocument();
  });

  it('clamps every unusable input to an empty ring', () => {
    expect(radialPercent(640, 1000)).toBe(64);
    expect(radialPercent(180, 100)).toBe(100);
    expect(radialPercent(-5, 100)).toBe(0);
    expect(radialPercent(5, 0)).toBe(0);
    expect(radialPercent(5, -100)).toBe(0);
    expect(radialPercent(Number.NaN, 100)).toBe(0);
    expect(radialPercent(Number.POSITIVE_INFINITY, 100)).toBe(0);
  });
});

// The chart chrome only draws once the container reports a size, and jsdom
// lays nothing out — so give the measurement hook a plot rect to read.
describe('Value axis', () => {
  const size = (property: 'clientWidth' | 'clientHeight', value: number) =>
    Object.defineProperty(HTMLElement.prototype, property, { configurable: true, value });

  // The accessible data table repeats every formatted value, so axis
  // assertions read the painted SVG chrome specifically.
  const axisLabels = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('svg text')).map((node) => node.textContent);

  beforeAll(() => {
    size('clientWidth', 480);
    size('clientHeight', 250);
  });

  afterAll(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
  });

  it('labels the trend value axis through the chart formatter', () => {
    const { container } = render(
      <TrendAreaChart
        ariaLabel="Agent cumulative earnings trend"
        data={[
          { bucket: 'Jul 1', earnings: 0 },
          { bucket: 'Jul 2', earnings: 400 },
        ]}
        series={[{ key: 'earnings', label: 'Earnings' }]}
        valueFormatter={(value) => `$${value}`}
        xKey="bucket"
      />
    );

    // Ticks over a 0-400 domain, so the axis carries the magnitude the shape
    // alone can't: a currency chart reads as currency.
    expect(axisLabels(container)).toEqual(expect.arrayContaining(['$400', '$200']));
  });

  it('labels histogram counts and keeps the tallest bar clear of the top edge', () => {
    const { container } = render(
      <HistogramBars
        ariaLabel="Ratings distribution"
        data={[
          { label: '0-20', value: 1 },
          { label: '20-40', value: 3 },
        ]}
      />
    );

    expect(axisLabels(container)).toEqual(expect.arrayContaining(['3', '1']));
    // Headroom past the tallest bar, so its own tick sits below the plot top.
    const top = Array.from(container.querySelectorAll('svg text')).find(
      (node) => node.textContent === '3'
    );
    expect(Number(top?.getAttribute('y'))).toBeGreaterThan(0);
  });

  it('renders the series legend in flow rather than over the plot', () => {
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

    const legend = container.querySelector('ul');
    expect(legend).toBeInTheDocument();
    expect(legend).toHaveTextContent('Tasks created');
    expect(container.querySelector('.absolute.inset-x-0.top-0')).not.toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { Sparkline } from './sparkline';

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

describe('Sparkline', () => {
  it('renders a single-point series without padding it', () => {
    // The renderer holds a one-point series flat, so the component hands the
    // data through as-is rather than duplicating the point.
    const { container } = render(<Sparkline data={[40]} />);

    expect(container.querySelector('[data-chart-engine="dither"]')).toBeInTheDocument();
  });

  it('renders an empty series', () => {
    const { container } = render(<Sparkline data={[]} />);

    expect(container.querySelector('[data-chart-engine="dither"]')).toBeInTheDocument();
  });

  it('renders as a line chart when asked', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} type="line" />);

    expect(container.querySelector('[data-chart-engine="dither"]')).toBeInTheDocument();
  });

  it('stays out of the accessibility tree, since the stat tile carries the values', () => {
    const { container } = render(<Sparkline data={[2, 4, 3, 7]} />);

    // Decorative: no name to announce and no values behind it, so it is hidden
    // rather than announced as an image with nothing readable inside.
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});

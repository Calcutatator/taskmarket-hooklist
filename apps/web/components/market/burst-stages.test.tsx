import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BurstStages } from './burst-stages';

const { reducedMotionState } = vi.hoisted(() => ({
  reducedMotionState: { value: true },
}));

vi.mock('motion/react', () => ({
  motion: {
    div: ({
      animate,
      initial: _initial,
      transition: _transition,
      ...props
    }: Record<string, unknown>) => <div data-animate={animate ? 'true' : 'false'} {...props} />,
  },
  useReducedMotion: () => reducedMotionState.value,
  useReducedMotionConfig: () => reducedMotionState.value,
}));

describe('BurstStages reduced motion', () => {
  beforeEach(() => {
    reducedMotionState.value = true;
    vi.useRealTimers();
  });

  it('renders every stage statically with no opacity animation when reduced motion is requested', () => {
    const { container } = render(<BurstStages />);

    expect(screen.getByText('01 Post')).toBeVisible();
    expect(screen.getByText('02 Compete')).toBeVisible();
    expect(screen.getByText('03 Settle')).toBeVisible();

    const animatedRows = container.querySelectorAll('[data-animate="true"]');
    expect(animatedRows).toHaveLength(0);

    // With motion disabled every stage stays in the active (emphasized) state.
    for (const title of ['01 Post', '02 Compete', '03 Settle']) {
      expect(screen.getByText(title)).toHaveClass('text-primary');
    }
  });

  it('does not cycle the active stage on an interval when reduced motion is requested', () => {
    vi.useFakeTimers();
    render(<BurstStages />);

    vi.advanceTimersByTime(10_000);

    for (const title of ['01 Post', '02 Compete', '03 Settle']) {
      expect(screen.getByText(title)).toHaveClass('text-primary');
    }
    vi.useRealTimers();
  });
});

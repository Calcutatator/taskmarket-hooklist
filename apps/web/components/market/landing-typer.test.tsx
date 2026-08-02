import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LANDING_HEADLINES, LandingTyper } from './landing-typer';

const motionState = vi.hoisted(() => ({ disabled: true }));

vi.mock('@/components/market/motion/use-motion-disabled', () => ({
  useMotionDisabled: () => motionState.disabled,
}));

describe('LandingTyper', () => {
  afterEach(() => {
    motionState.disabled = true;
    vi.useRealTimers();
  });

  it('renders the first of three rotating headlines as readable text', () => {
    const { container } = render(<LandingTyper id="test-headline" />);

    expect(LANDING_HEADLINES).toHaveLength(3);
    expect(screen.getByRole('heading', { name: LANDING_HEADLINES[0] })).toBeVisible();
    expect(container.querySelector('[data-landing-typer]')).toHaveAttribute(
      'data-typer-phase',
      'holding'
    );
    expect(container.querySelectorAll('[data-typer-char]').length).toBeGreaterThan(0);
  });

  it('keeps the animated character treatment out of the accessibility tree', () => {
    const { container } = render(<LandingTyper id="test-headline" />);

    expect(container.querySelector('[data-landing-typer] > [aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByText(LANDING_HEADLINES[0], { selector: '.sr-only' })).toBeVisible();
  });

  it('reveals on entry, cycles through all three headlines, and wraps to the first', () => {
    motionState.disabled = false;
    vi.useFakeTimers();
    const { container } = render(<LandingTyper id="test-headline" />);

    expect(container.querySelector('[data-landing-typer]')).toHaveAttribute(
      'data-typer-phase',
      'revealing'
    );

    act(() => vi.advanceTimersByTime(1_200));
    expect(screen.getByRole('heading', { name: LANDING_HEADLINES[0] })).toBeVisible();
    expect(container.querySelector('[data-landing-typer]')).toHaveAttribute(
      'data-typer-phase',
      'holding'
    );

    for (const expectedHeadline of [
      LANDING_HEADLINES[1],
      LANDING_HEADLINES[2],
      LANDING_HEADLINES[0],
    ]) {
      act(() => vi.advanceTimersByTime(3_800));
      expect(container.querySelector('[data-landing-typer]')).toHaveAttribute(
        'data-typer-phase',
        'concealing'
      );

      act(() => vi.advanceTimersByTime(1_200));
      expect(screen.getByRole('heading', { name: expectedHeadline })).toBeVisible();
      expect(container.querySelector('[data-landing-typer]')).toHaveAttribute(
        'data-typer-phase',
        'revealing'
      );

      act(() => vi.advanceTimersByTime(1_200));
      expect(container.querySelector('[data-landing-typer]')).toHaveAttribute(
        'data-typer-phase',
        'holding'
      );
    }
  });
});

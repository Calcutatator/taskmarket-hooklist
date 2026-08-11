import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskResponse } from '@taskmarket/shared';

import { PublishedCelebration } from './published-celebration';

const { motionState, router, routeState } = vi.hoisted(() => ({
  motionState: { disabled: false },
  router: {
    replace: vi.fn(),
  },
  routeState: {
    pathname: '/dashboard/tasks/task-1',
    searchParams: new URLSearchParams('published=1&taskDropId=drop_growth_123'),
  },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => routeState.pathname,
  useRouter: () => router,
  useSearchParams: () => routeState.searchParams,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
  },
}));

vi.mock('@/components/market/motion/use-motion-disabled', () => ({
  useMotionDisabled: () => motionState.disabled,
}));

const task = { auctionType: null, mode: 'bounty' } as TaskResponse;

describe('PublishedCelebration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    motionState.disabled = false;
    router.replace.mockClear();
    routeState.searchParams = new URLSearchParams('published=1&taskDropId=drop_growth_123');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the drop CTA visible instead of auto-dismissing it', () => {
    render(<PublishedCelebration task={task} />);

    expect(screen.getByRole('link', { name: /view drop/i })).toHaveAttribute(
      'href',
      '/drops/drop_growth_123'
    );

    act(() => {
      vi.advanceTimersByTime(2_300);
    });

    expect(screen.getByRole('link', { name: /view drop/i })).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('keeps next-step guidance visible and links to Inbox after publication', () => {
    routeState.searchParams = new URLSearchParams('published=1');
    render(<PublishedCelebration task={task} />);

    expect(screen.getByText('No action is needed right now')).toBeInTheDocument();
    expect(screen.getByText(/workers can submit work until the deadline/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open inbox/i })).toHaveAttribute(
      'href',
      '/dashboard/inbox'
    );
    expect(screen.getByRole('button', { name: /view activity/i })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(screen.getByText('No action is needed right now')).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('renders the persistent guidance without motion when reduced motion is requested', () => {
    motionState.disabled = true;
    routeState.searchParams = new URLSearchParams('published=1');

    render(<PublishedCelebration task={task} />);

    expect(screen.getByText('No action is needed right now')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open inbox/i })).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

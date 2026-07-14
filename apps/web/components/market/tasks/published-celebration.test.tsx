import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PublishedCelebration } from './published-celebration';

const { router, routeState } = vi.hoisted(() => ({
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
  useMotionDisabled: () => false,
}));

describe('PublishedCelebration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    router.replace.mockClear();
    routeState.searchParams = new URLSearchParams('published=1&taskDropId=drop_growth_123');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the drop CTA visible instead of auto-dismissing it', () => {
    render(<PublishedCelebration />);

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
});

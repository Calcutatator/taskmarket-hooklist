import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

import { DropLifecycleRefresh } from './drop-lifecycle-refresh';

describe('DropLifecycleRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T00:00:00.000Z'));
    refresh.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes the server-rendered lifecycle once the entry deadline passes', () => {
    render(<DropLifecycleRefresh refreshAt="2026-07-27T00:00:01.000Z" />);

    vi.advanceTimersByTime(1_249);
    expect(refresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a valid active deadline', () => {
    const { rerender } = render(<DropLifecycleRefresh refreshAt={null} />);
    rerender(<DropLifecycleRefresh refreshAt="not-a-date" />);

    vi.runAllTimers();
    expect(refresh).not.toHaveBeenCalled();
  });
});

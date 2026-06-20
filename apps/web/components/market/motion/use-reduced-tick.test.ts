import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useReducedTick } from './use-reduced-tick';

describe('useReducedTick', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('seeds a value after mount and re-ticks on the interval when enabled', () => {
    const { result } = renderHook(() => useReducedTick(1_000, true));

    expect(typeof result.current).toBe('number');
    const first = result.current;

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(result.current).not.toBe(first);
  });

  it('stays frozen (null) when disabled', () => {
    const { result } = renderHook(() => useReducedTick(1_000, false));

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(result.current).toBeNull();
  });
});

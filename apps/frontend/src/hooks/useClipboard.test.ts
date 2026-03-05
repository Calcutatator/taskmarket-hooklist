import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useClipboard } from './useClipboard';

describe('useClipboard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with copied = false', () => {
    const { result } = renderHook(() => useClipboard());
    expect(result.current.copied).toBe(false);
  });

  it('sets copied to true after copy()', async () => {
    const { result } = renderHook(() => useClipboard());
    await act(async () => {
      result.current.copy('hello');
    });
    expect(result.current.copied).toBe(true);
  });

  it('resets copied to false after timeout', async () => {
    const { result } = renderHook(() => useClipboard(2000));
    await act(async () => {
      result.current.copy('hello');
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.copied).toBe(false);
  });
});

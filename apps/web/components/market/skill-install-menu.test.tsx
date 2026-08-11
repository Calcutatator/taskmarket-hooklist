import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SkillInstallMenu } from './skill-install-menu';

function installClipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

async function copyWith(method: 'curl' | 'npx') {
  fireEvent.pointerDown(
    screen.getByRole('button', { name: /^(install skill|copied (curl|npx))$/i }),
    { button: 0, ctrlKey: false }
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(`copy with ${method}`, 'i') }));
    await Promise.resolve();
  });
}

describe('SkillInstallMenu', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  });

  it('resets the copied label after 1600 ms while mounted', async () => {
    installClipboard();

    render(<SkillInstallMenu />);

    await copyWith('npx');

    expect(screen.getByRole('button', { name: /^copied npx$/i })).toBeVisible();

    act(() => vi.advanceTimersByTime(1599));
    expect(screen.getByRole('button', { name: /^copied npx$/i })).toBeVisible();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('button', { name: /^install skill$/i })).toBeVisible();
  });

  it('restarts copied-state timing when another installation method is selected', async () => {
    installClipboard();
    render(<SkillInstallMenu />);

    await copyWith('npx');
    act(() => vi.advanceTimersByTime(800));

    await copyWith('curl');
    expect(screen.getByRole('button', { name: /^copied curl$/i })).toBeVisible();

    act(() => vi.advanceTimersByTime(800));
    expect(screen.getByRole('button', { name: /^copied curl$/i })).toBeVisible();

    act(() => vi.advanceTimersByTime(800));
    expect(screen.getByRole('button', { name: /^install skill$/i })).toBeVisible();
  });

  it('clears copied-state timing on unmount without a later state update', async () => {
    installClipboard();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const setTimeout = vi.spyOn(window, 'setTimeout');
    const clearTimeout = vi.spyOn(window, 'clearTimeout');
    const { unmount } = render(<SkillInstallMenu />);

    await copyWith('npx');
    const resetTimerIndex = setTimeout.mock.calls.findIndex(([, delay]) => delay === 1600);
    expect(resetTimerIndex).toBeGreaterThanOrEqual(0);
    const resetTimer = setTimeout.mock.results[resetTimerIndex]?.value;

    unmount();
    expect(clearTimeout).toHaveBeenCalledWith(resetTimer);

    act(() => vi.advanceTimersByTime(1600));
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('does not enter copied state or schedule a reset when clipboard writing fails', async () => {
    const setTimeout = vi.spyOn(window, 'setTimeout');
    installClipboard(vi.fn().mockRejectedValue(new Error('clipboard unavailable')));
    render(<SkillInstallMenu />);

    await copyWith('npx');

    expect(screen.getByRole('button', { name: /^install skill$/i })).toBeVisible();
    expect(setTimeout).not.toHaveBeenCalledWith(expect.any(Function), 1600);
  });
});

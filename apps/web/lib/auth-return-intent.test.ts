import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearAuthReturnIntent,
  rememberAuthReturnIntent,
  resumeAuthReturnIntent,
} from '@/lib/auth-return-intent';

describe('authentication return intent', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/tasks/private-task?source=invite#access');
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('restores focus to the action that initiated sign-in on the same route', async () => {
    const action = document.createElement('button');
    action.id = 'private-task-access';
    document.body.append(action);

    rememberAuthReturnIntent('private-task-access');
    resumeAuthReturnIntent();
    await new Promise((resolve) => window.requestAnimationFrame(resolve));

    expect(action).toHaveFocus();
    expect(window.sessionStorage.getItem('taskmarket:auth-return-intent')).toBeNull();
  });

  it('drops an expired return intent', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-25T00:00:00Z'));
    rememberAuthReturnIntent('private-task-access');

    vi.advanceTimersByTime(30 * 60 * 1000 + 1);
    resumeAuthReturnIntent();

    expect(window.sessionStorage.getItem('taskmarket:auth-return-intent')).toBeNull();
  });

  it('drops malformed return intents without interrupting authentication', () => {
    window.sessionStorage.setItem('taskmarket:auth-return-intent', '{malformed');

    expect(() => resumeAuthReturnIntent()).not.toThrow();
    expect(window.sessionStorage.getItem('taskmarket:auth-return-intent')).toBeNull();
  });

  it('keeps cleanup best-effort when session storage is restricted', () => {
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Storage is blocked', 'SecurityError');
    });

    expect(() => clearAuthReturnIntent()).not.toThrow();
    removeItem.mockRestore();
  });
});

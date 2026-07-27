import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearAllCachedTaskAccessGrants,
  clearCachedTaskAccessGrant,
  getCachedTaskAccessGrant,
  setCachedTaskAccessGrant,
} from './task-access-grants';

describe('private task access grants', () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearAllCachedTaskAccessGrants();
    vi.useRealTimers();
  });

  it('keeps a password grant for the current browser session', () => {
    setCachedTaskAccessGrant('task-1', 'grant-1');

    expect(sessionStorage.getItem('taskmarket:task-access:task-1')).toContain('grant-1');
    expect(getCachedTaskAccessGrant('task-1')).toBe('grant-1');

    clearCachedTaskAccessGrant('task-1');
    expect(sessionStorage.getItem('taskmarket:task-access:task-1')).toBeNull();
  });

  it('expires grants and clears every private task grant on logout', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-25T00:00:00Z'));
    setCachedTaskAccessGrant('task-1', 'grant-1');
    setCachedTaskAccessGrant('task-2', 'grant-2');

    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    expect(getCachedTaskAccessGrant('task-1')).toBeUndefined();

    clearAllCachedTaskAccessGrants();
    expect(getCachedTaskAccessGrant('task-2')).toBeUndefined();
    expect(
      Object.keys(sessionStorage).filter((key) => key.startsWith('taskmarket:task-access:'))
    ).toHaveLength(0);
  });

  it('uses the server-provided expiresAt instead of a fixed client TTL, matching the backend grant lifetime', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-25T00:00:00Z'));
    setCachedTaskAccessGrant('task-1', 'grant-1', '2026-07-26T00:00:00Z');

    vi.advanceTimersByTime(24 * 60 * 60 * 1000 - 1);
    expect(getCachedTaskAccessGrant('task-1')).toBe('grant-1');

    vi.advanceTimersByTime(2);
    expect(getCachedTaskAccessGrant('task-1')).toBeUndefined();
  });

  it('falls back to the default TTL when expiresAt is missing or unparsable', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-25T00:00:00Z'));
    setCachedTaskAccessGrant('task-1', 'grant-1', 'not-a-date');

    vi.advanceTimersByTime(24 * 60 * 60 * 1000 - 1);
    expect(getCachedTaskAccessGrant('task-1')).toBe('grant-1');

    vi.advanceTimersByTime(2);
    expect(getCachedTaskAccessGrant('task-1')).toBeUndefined();
  });
});

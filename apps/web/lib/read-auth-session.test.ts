import { beforeEach, describe, expect, it, vi } from 'vitest';

const ADDRESS = '0x1111111111111111111111111111111111111111';
const HEADERS = {
  'X-Taskmarket-Caller-Address': ADDRESS,
  'X-Taskmarket-Caller-Signature': '0xsignature',
};
const SESSION_KEY = 'taskmarket:read-auth';

describe('read-auth browser session', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.resetModules();
  });

  it('retains the verified wallet proof when the app reloads during the same login session', async () => {
    const createHeaders = vi.fn().mockResolvedValue(HEADERS);
    const firstDocument = await import('./read-auth');
    await firstDocument.getOrCreateCachedReadAuthHeaders(ADDRESS, createHeaders);

    expect(firstDocument.hasCachedReadAuthHeaders(ADDRESS)).toBe(true);

    vi.resetModules();
    const reloadedDocument = await import('./read-auth');
    await reloadedDocument.getOrCreateCachedReadAuthHeaders(ADDRESS, createHeaders);

    expect(createHeaders).toHaveBeenCalledTimes(1);
    expect(reloadedDocument.hasCachedReadAuthHeaders(ADDRESS)).toBe(true);
    expect(reloadedDocument.getCachedReadAuthHeaders()).toEqual(HEADERS);
  });

  it('removes the browser-session proof on explicit auth cleanup', async () => {
    const readAuth = await import('./read-auth');
    readAuth.setCachedReadAuthHeaders(ADDRESS, HEADERS);

    readAuth.clearCachedReadAuthHeaders();
    vi.resetModules();

    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    expect((await import('./read-auth')).getCachedReadAuthHeaders()).toEqual({});
  });

  it('ignores malformed or mismatched browser-session proofs', async () => {
    sessionStorage.setItem(SESSION_KEY, '{malformed');
    let readAuth = await import('./read-auth');
    expect(readAuth.getCachedReadAuthHeaders()).toEqual({});
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();

    vi.resetModules();
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        address: ADDRESS,
        headers: { ...HEADERS, 'X-Taskmarket-Caller-Address': `0x${'2'.repeat(40)}` },
        version: 1,
      })
    );
    readAuth = await import('./read-auth');

    expect(readAuth.getCachedReadAuthHeaders()).toEqual({});
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });
});

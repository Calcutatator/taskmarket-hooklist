import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  claimGameLaunch,
  consumeCatalogReturnScroll,
  getCatalogHref,
  prepareGameReturn,
  rememberGameLaunch,
} from './game-navigation';

describe('game navigation', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    window.sessionStorage.clear();
    document.documentElement.removeAttribute('data-slap-chop-game-launch');
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 624 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves a catalog query in the fallback catalog address', () => {
    expect(getCatalogHref('space arcade')).toBe('/?q=space%20arcade');
    expect(getCatalogHref('   ')).toBe('/');
  });

  it('claims an immediate catalog click and restores its stored scroll position after Back', () => {
    rememberGameLaunch({ query: 'space', slug: 'silent-orbit' });
    window.history.pushState(null, '', '/games/silent-orbit?q=space');

    claimGameLaunch('silent-orbit');

    expect(prepareGameReturn('silent-orbit')).toEqual({
      href: '/?q=space',
      kind: 'history',
    });
    expect(consumeCatalogReturnScroll('/?q=space')).toBe(624);
    expect(consumeCatalogReturnScroll('/?q=space')).toBeNull();
  });

  it('invalidates an unclaimed same-slug marker so a direct entry falls back to the catalog', () => {
    rememberGameLaunch({ query: 'old-query', slug: 'silent-orbit' });
    window.history.pushState(null, '', '/games/silent-orbit?q=arcade');

    // A fresh page load has no client-route claim. Direct entry must never treat the stored
    // catalog click as permission to navigate browser history.
    expect(prepareGameReturn('silent-orbit')).toEqual({ href: '/', kind: 'fallback' });
    expect(consumeCatalogReturnScroll('/?q=old-query')).toBeNull();
  });

  it('rejects a stale same-slug session marker after the player bundle reloads for direct entry', async () => {
    rememberGameLaunch({ query: 'old-query', slug: 'silent-orbit' });
    window.history.pushState(null, '', '/games/silent-orbit?q=arcade');

    // A full page navigation creates a new document, so it has no same-document click nonce. The
    // storage value may survive in a duplicated tab but cannot become a history return path.
    document.documentElement.removeAttribute('data-slap-chop-game-launch');
    vi.resetModules();
    const navigation = await import('./game-navigation');

    navigation.claimGameLaunch('silent-orbit');

    expect(navigation.prepareGameReturn('silent-orbit')).toEqual({
      href: '/',
      kind: 'fallback',
    });
  });
});

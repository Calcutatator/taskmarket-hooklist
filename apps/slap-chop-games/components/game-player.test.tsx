import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { rememberGameLaunch } from '@/lib/game-navigation';
import { gameFixture, gameHtml } from '@/test/game-fixtures';

const routerReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace }),
}));

import { GamePlayer } from './game-player';

function detailResponse(artifactUrl: string) {
  return new Response(JSON.stringify({ ...gameFixture, artifactUrl }), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  });
}

describe('GamePlayer', () => {
  beforeEach(() => {
    routerReplace.mockReset();
    window.history.replaceState(null, '', '/');
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('refreshes the catalog detail URL after an expired artifact URL and verifies before iframe execution', async () => {
    const detailUrl = `${window.location.origin}/api/games/silent-orbit`;
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);

      if (url === 'https://files.taskmarket.dev/expired.html') {
        return new Response('', { status: 403 });
      }

      if (url === detailUrl) {
        return detailResponse('https://files.taskmarket.dev/fresh.html');
      }

      if (url === 'https://files.taskmarket.dev/fresh.html') {
        return new Response(gameHtml, { status: 200 });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(
      <GamePlayer
        initialGame={{ ...gameFixture, artifactUrl: 'https://files.taskmarket.dev/expired.html' }}
        slug="silent-orbit"
      />
    );

    expect(await screen.findByRole('heading', { name: 'Game link expired' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Refresh game link' }));

    expect(await screen.findByTitle('Silent Orbit game')).toHaveAttribute(
      'sandbox',
      'allow-scripts'
    );
    expect(fetchMock).toHaveBeenCalledWith(
      new URL(detailUrl),
      expect.objectContaining({ cache: 'no-store' })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://files.taskmarket.dev/fresh.html',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('uses the catalog root as the direct-entry Back fallback instead of traversing unknown history', async () => {
    const user = userEvent.setup();

    render(
      <GamePlayer initialFailure={{ kind: 'not_found' }} initialGame={null} slug="silent-orbit" />
    );

    await user.click(screen.getByRole('button', { name: 'Back to catalog' }));

    expect(routerReplace).toHaveBeenCalledWith('/');
  });

  it('keeps a same-document catalog return through the Strict Mode effect probe', async () => {
    window.history.replaceState(null, '', '/?q=orbit');
    rememberGameLaunch({ query: 'orbit', slug: 'silent-orbit' });
    window.history.pushState(null, '', '/games/silent-orbit?q=orbit');

    render(
      <StrictMode>
        <GamePlayer initialFailure={{ kind: 'not_found' }} initialGame={null} slug="silent-orbit" />
      </StrictMode>
    );

    await waitFor(() => {
      expect(
        JSON.parse(window.sessionStorage.getItem('slap-chop-games:game-launch') ?? '{}')
      ).toMatchObject({ returnHref: '/?q=orbit', state: 'claimed' });
    });
  });

  it('reports integrity failure through the bounded player telemetry seam', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);

      if (url === 'https://files.taskmarket.dev/silent-orbit.html') {
        return new Response('<main>tampered game</main>', { status: 200 });
      }

      if (url === '/api/player-telemetry') {
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<GamePlayer initialGame={gameFixture} slug="silent-orbit" />);

    expect(
      await screen.findByRole('heading', { name: 'Game integrity check failed' })
    ).toBeVisible();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/player-telemetry',
        expect.objectContaining({
          body: JSON.stringify({ event: 'integrity_failure', reason: 'sha256_mismatch' }),
        })
      );
    });
  });

  it('reports a failed artifact refresh without putting the game identity in the event', async () => {
    const detailUrl = `${window.location.origin}/api/games/silent-orbit`;
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);

      if (url === 'https://files.taskmarket.dev/expired.html') {
        return new Response('', { status: 403 });
      }

      if (url === detailUrl) {
        return new Response('', { status: 503 });
      }

      if (url === '/api/player-telemetry') {
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(
      <GamePlayer
        initialGame={{ ...gameFixture, artifactUrl: 'https://files.taskmarket.dev/expired.html' }}
        slug="silent-orbit"
      />
    );

    expect(await screen.findByRole('heading', { name: 'Game link expired' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Refresh game link' }));

    expect(await screen.findByRole('heading', { name: 'Game details unavailable' })).toBeVisible();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/player-telemetry',
        expect.objectContaining({
          body: JSON.stringify({
            event: 'artifact_refresh_failure',
            reason: 'artifact_fetch_network',
          }),
        })
      );
    });
  });
});

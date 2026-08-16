import { describe, expect, it } from 'vitest';

import { gameFixture } from '@/test/game-fixtures';

import { fetchGameDetail, getGameDetailUrl } from './game-detail-api';

describe('game detail API', () => {
  it('requests the slug-safe catalog detail endpoint and validates its public DTO', async () => {
    const fetcher = async (input: string | URL) => {
      expect(String(input)).toBe('https://api.taskmarket.dev/api/games/silent-orbit');
      return new Response(JSON.stringify(gameFixture), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    };

    await expect(
      fetchGameDetail('silent-orbit', {
        apiBaseUrl: 'https://api.taskmarket.dev',
        fetcher,
      })
    ).resolves.toEqual({ game: gameFixture, ok: true });
    expect(getGameDetailUrl('https://api.taskmarket.dev', 'silent orbit').pathname).toBe(
      '/api/games/silent%20orbit'
    );
  });

  it('does not call the backend for an invalid slug and keeps catalog absence distinct', async () => {
    let called = false;

    const invalid = await fetchGameDetail('Silent Orbit', {
      apiBaseUrl: 'https://api.taskmarket.dev',
      fetcher: async () => {
        called = true;
        return new Response();
      },
    });
    const missing = await fetchGameDetail('missing-game', {
      apiBaseUrl: 'https://api.taskmarket.dev',
      fetcher: async () =>
        new Response('null', {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
    });

    expect(called).toBe(false);
    expect(invalid).toEqual({ failure: { kind: 'not_found' }, ok: false });
    expect(missing).toEqual({ failure: { kind: 'not_found' }, ok: false });
  });

  it('fails closed when the detail response is unavailable or malformed', async () => {
    const unavailable = await fetchGameDetail('silent-orbit', {
      apiBaseUrl: 'https://api.taskmarket.dev',
      fetcher: async () => new Response('', { status: 503 }),
    });
    const malformed = await fetchGameDetail('silent-orbit', {
      apiBaseUrl: 'https://api.taskmarket.dev',
      fetcher: async () =>
        new Response(JSON.stringify({ artifactUrl: 'not-a-url' }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
    });

    expect(unavailable).toEqual({ failure: { kind: 'unavailable', status: 503 }, ok: false });
    expect(malformed).toEqual({ failure: { kind: 'invalid_response' }, ok: false });
  });
});

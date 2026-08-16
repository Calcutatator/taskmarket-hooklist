import type { GameCatalogItem } from '@taskmarket/shared';
import { describe, expect, it, vi } from 'vitest';

import { fetchCatalogSnapshot, getSearchQuery } from './catalog-api';

const game: GameCatalogItem = {
  coverAltText: 'A sample game cover',
  coverUrl: 'https://covers.taskmarket.dev/sample.webp',
  creatorName: 'Studio Sample',
  description: 'A short game description',
  downvoteCount: 1,
  id: 'game-sample',
  netVotes: 4,
  publishedAt: '2026-08-16T00:00:00.000Z',
  slug: 'sample-game',
  tags: ['arcade'],
  taskDescription: 'A curated task brief for the sample game',
  title: 'Sample Game',
  upvoteCount: 5,
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

// Verifies: ADR-0090
describe('fetchCatalogSnapshot', () => {
  it('keeps API page order while collecting every cursor page', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ games: [game], nextCursor: 'cursor-2' }))
      .mockResolvedValueOnce(
        response({
          games: [{ ...game, id: 'game-second', slug: 'second-game', title: 'Second Game' }],
          nextCursor: null,
        })
      );

    const result = await fetchCatalogSnapshot({
      apiBaseUrl: 'https://api.taskmarket.test',
      fetcher,
    });

    expect(result).toEqual({
      games: [game, { ...game, id: 'game-second', slug: 'second-game', title: 'Second Game' }],
      ok: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      'https://api.taskmarket.test/api/games?limit=48'
    );
    expect(String(fetcher.mock.calls[1]?.[0])).toBe(
      'https://api.taskmarket.test/api/games?limit=48&cursor=cursor-2'
    );
  });

  it('reports an unreadable response instead of exposing unvalidated data', async () => {
    const result = await fetchCatalogSnapshot({
      apiBaseUrl: 'https://api.taskmarket.test',
      fetcher: vi.fn().mockResolvedValue(response({ games: [{ id: 'missing-fields' }] })),
    });

    expect(result).toEqual({ failure: { kind: 'invalid_response' }, ok: false });
  });

  it('reports a failed backend response as unavailable', async () => {
    const result = await fetchCatalogSnapshot({
      apiBaseUrl: 'https://api.taskmarket.test',
      fetcher: vi.fn().mockResolvedValue(response({ message: 'offline' }, 503)),
    });

    expect(result).toEqual({ failure: { kind: 'unavailable', status: 503 }, ok: false });
  });
});

describe('getSearchQuery', () => {
  it('normalizes direct and repeated URL query values', () => {
    expect(getSearchQuery('  orbit  ')).toBe('orbit');
    expect(getSearchQuery(['puzzle', 'ignored'])).toBe('puzzle');
    expect(getSearchQuery(undefined)).toBe('');
  });
});

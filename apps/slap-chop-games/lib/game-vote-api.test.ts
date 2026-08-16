import { describe, expect, it } from 'vitest';

import { fetchGameVoteState, getGameVoteUrl, submitGameVote } from './game-vote-api';

const vote = {
  downvoteCount: 2,
  gameId: 'orbit-1',
  netVotes: 5,
  selectedVote: 1,
  upvoteCount: 7,
} as const;

describe('game vote API', () => {
  it('reads the canonical private vote state with a bearer token', async () => {
    const fetcher = async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.taskmarket.dev/api/games/orbit-1/vote');
      expect(init).toMatchObject({
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          authorization: 'Bearer access-token',
        },
      });

      return new Response(JSON.stringify(vote), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    };

    await expect(
      fetchGameVoteState('orbit-1', 'access-token', {
        apiBaseUrl: 'https://api.taskmarket.dev',
        fetcher,
      })
    ).resolves.toEqual({ ok: true, vote });
    expect(getGameVoteUrl('https://api.taskmarket.dev', 'orbit game').pathname).toBe(
      '/api/games/orbit%20game/vote'
    );
  });

  it('sends an intentional vote value without wallet or payment headers', async () => {
    const fetcher = async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.taskmarket.dev/api/games/orbit-1/vote');
      expect(init).toMatchObject({
        body: JSON.stringify({ gameId: 'orbit-1', value: -1 }),
        headers: {
          accept: 'application/json',
          authorization: 'Bearer access-token',
          'content-type': 'application/json',
        },
        method: 'POST',
      });

      return new Response(JSON.stringify({ ...vote, selectedVote: -1 }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    };

    await expect(
      submitGameVote('orbit-1', -1, 'access-token', {
        apiBaseUrl: 'https://api.taskmarket.dev',
        fetcher,
      })
    ).resolves.toEqual({ ok: true, vote: { ...vote, selectedVote: -1 } });
  });

  it('does not send invalid or anonymous votes and maps server failures for rollback', async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return new Response('', { status: 429 });
    };

    await expect(
      submitGameVote('orbit-1', 1, null, {
        apiBaseUrl: 'https://api.taskmarket.dev',
        fetcher,
      })
    ).resolves.toEqual({ failure: { kind: 'unauthorized' }, ok: false });
    await expect(
      fetchGameVoteState('', 'access-token', {
        apiBaseUrl: 'https://api.taskmarket.dev',
        fetcher,
      })
    ).resolves.toEqual({ failure: { kind: 'not_found' }, ok: false });
    expect(calls).toBe(0);

    await expect(
      submitGameVote('orbit-1', 1, 'access-token', {
        apiBaseUrl: 'https://api.taskmarket.dev',
        fetcher,
      })
    ).resolves.toEqual({ failure: { kind: 'rate_limited', status: 429 }, ok: false });
  });

  it('rejects malformed successful responses instead of trusting optimistic state', async () => {
    const malformed = await submitGameVote('orbit-1', 1, 'access-token', {
      apiBaseUrl: 'https://api.taskmarket.dev',
      fetcher: async () =>
        new Response(JSON.stringify({ gameId: 'orbit-1', selectedVote: 1 }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
    });

    expect(malformed).toEqual({ failure: { kind: 'invalid_response' }, ok: false });
  });
});

// Verifies: ADR-0090
import { describe, expect, it } from 'vitest';

import {
  calculateGameHotScore,
  sortGamesByRanking,
  SLAP_CHOP_HOT_AGE_DIVISOR_SECONDS,
} from '../../../src/services/game-ranking';

const EPOCH = new Date('2026-01-01T00:00:00.000Z');
const ONE_WEEK_AFTER_EPOCH = new Date(
  EPOCH.getTime() + SLAP_CHOP_HOT_AGE_DIVISOR_SECONDS * 1_000
);

function game(overrides: Partial<Parameters<typeof calculateGameHotScore>[0]> = {}) {
  return {
    id: 'game-1',
    publishedAt: EPOCH,
    upvoteCount: 0,
    downvoteCount: 0,
    ...overrides,
  };
}

describe('Slap-Chop Game ranking', () => {
  it('matches the fixed seven-day Hot-score vectors', () => {
    const vectors = [
      { input: game(), expected: 0 },
      { input: game({ publishedAt: ONE_WEEK_AFTER_EPOCH }), expected: 1 },
      { input: game({ upvoteCount: 10 }), expected: 1 },
      { input: game({ downvoteCount: 10 }), expected: -1 },
      { input: game({ upvoteCount: 100 }), expected: 2 },
      { input: game({ downvoteCount: 100, publishedAt: ONE_WEEK_AFTER_EPOCH }), expected: -1 },
    ];

    for (const vector of vectors) {
      expect(calculateGameHotScore(vector.input)).toBeCloseTo(vector.expected, 12);
    }
  });

  it('is monotonic when a vote increases the net total', () => {
    const baseline = calculateGameHotScore(game({ upvoteCount: 9, downvoteCount: 3 }));
    const increased = calculateGameHotScore(game({ upvoteCount: 10, downvoteCount: 3 }));
    const reversed = calculateGameHotScore(game({ upvoteCount: 9, downvoteCount: 4 }));

    expect(increased).toBeGreaterThan(baseline);
    expect(reversed).toBeLessThan(baseline);
  });

  it('uses net votes, publication time, then ID for deterministic Hot ties', () => {
    const ordered = sortGamesByRanking(
      [
        // Both score exactly one: 10 net votes at epoch and zero votes one week after it.
        game({ id: 'newer-zero-vote', publishedAt: ONE_WEEK_AFTER_EPOCH }),
        game({ id: 'older-ten-vote', upvoteCount: 10 }),
        // Same zero score and same timestamp; IDs settle the final tie.
        game({ id: 'zeta', publishedAt: EPOCH }),
        game({ id: 'alpha', publishedAt: EPOCH }),
      ],
      'hot'
    );

    expect(ordered.map((entry) => entry.id)).toEqual([
      'older-ten-vote',
      'newer-zero-vote',
      'alpha',
      'zeta',
    ]);
  });

  it('orders a true zero-vote catalog newest first', () => {
    const zeroVoteGames = [
      game({ id: 'old', publishedAt: EPOCH }),
      game({ id: 'new', publishedAt: ONE_WEEK_AFTER_EPOCH }),
      game({ id: 'middle', publishedAt: new Date(EPOCH.getTime() + 1_000) }),
    ];

    expect(sortGamesByRanking(zeroVoteGames, 'hot').map((entry) => entry.id)).toEqual([
      'new',
      'middle',
      'old',
    ]);
  });

  it('makes newest-first rollback ignore vote totals', () => {
    const gamesWithVotes = [
      game({ id: 'old', publishedAt: EPOCH, upvoteCount: 1_000 }),
      game({ id: 'new', publishedAt: ONE_WEEK_AFTER_EPOCH }),
      game({ id: 'middle', publishedAt: new Date(EPOCH.getTime() + 1_000) }),
    ];

    expect(sortGamesByRanking(gamesWithVotes, 'hot').map((entry) => entry.id)).toEqual([
      'old',
      'new',
      'middle',
    ]);
    expect(sortGamesByRanking(gamesWithVotes, 'new').map((entry) => entry.id)).toEqual([
      'new',
      'middle',
      'old',
    ]);
  });

  it('rejects malformed ranking inputs instead of making an unstable order', () => {
    expect(() => calculateGameHotScore(game({ id: '' }))).toThrow('stable ID');
    expect(() => calculateGameHotScore(game({ upvoteCount: -1 }))).toThrow('non-negative');
  });
});

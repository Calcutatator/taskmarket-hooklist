// Implements: ADR-0090
//
// The catalog's ordering lives only on the backend. Do not copy this formula into a browser:
// clients receive already ordered catalog DTOs and display the resulting vote totals instead.

export const SLAP_CHOP_RANKING_EPOCH_MS = Date.parse('2026-01-01T00:00:00.000Z');
export const SLAP_CHOP_HOT_AGE_DIVISOR_SECONDS = 604_800;

export type GameRankingMode = 'hot' | 'new';

export type GameRankingInput = {
  id: string;
  publishedAt: Date;
  upvoteCount: number;
  downvoteCount: number;
};

export type GameRankingPosition = {
  id: string;
  publishedAt: Date;
  hotScore: number;
  netVotes: number;
};

function compareDescending(left: number, right: number): number {
  if (left === right) return 0;
  return left > right ? -1 : 1;
}

function compareAscending(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function assertValidRankingInput(input: GameRankingInput): void {
  if (!input.id) {
    throw new Error('A ranked game needs a stable ID');
  }
  if (!Number.isFinite(input.publishedAt.getTime())) {
    throw new Error(`A ranked game needs a valid publication time: ${input.id}`);
  }
  if (!Number.isInteger(input.upvoteCount) || input.upvoteCount < 0) {
    throw new Error(`A ranked game needs a non-negative integer upvote count: ${input.id}`);
  }
  if (!Number.isInteger(input.downvoteCount) || input.downvoteCount < 0) {
    throw new Error(`A ranked game needs a non-negative integer downvote count: ${input.id}`);
  }
}

/**
 * Seven-day Reddit-style Hot score from ADR-0090. Publication time is the only time input;
 * score does not depend on the request clock, so an unchanged catalog has a stable order.
 */
export function calculateGameHotScore(input: GameRankingInput): number {
  assertValidRankingInput(input);

  const netVotes = input.upvoteCount - input.downvoteCount;
  const magnitude = Math.log10(Math.max(Math.abs(netVotes), 1));
  const voteTerm = Math.sign(netVotes) * magnitude;
  const ageTerm =
    (input.publishedAt.getTime() - SLAP_CHOP_RANKING_EPOCH_MS) /
    (SLAP_CHOP_HOT_AGE_DIVISOR_SECONDS * 1_000);

  return voteTerm + ageTerm;
}

export function toGameRankingPosition(input: GameRankingInput): GameRankingPosition {
  assertValidRankingInput(input);
  return {
    id: input.id,
    publishedAt: input.publishedAt,
    netVotes: input.upvoteCount - input.downvoteCount,
    hotScore: calculateGameHotScore(input),
  };
}

/**
 * Negative means left comes first. Hot ties intentionally use net votes, publication time, and
 * game ID in that exact order. Newest rollback keeps only publication time and stable game ID.
 */
export function compareGameRankingPositions(
  left: GameRankingPosition,
  right: GameRankingPosition,
  mode: GameRankingMode
): number {
  if (mode === 'hot') {
    const byHotScore = compareDescending(left.hotScore, right.hotScore);
    if (byHotScore !== 0) return byHotScore;

    const byNetVotes = compareDescending(left.netVotes, right.netVotes);
    if (byNetVotes !== 0) return byNetVotes;
  }

  const byPublishedAt = compareDescending(left.publishedAt.getTime(), right.publishedAt.getTime());
  if (byPublishedAt !== 0) return byPublishedAt;

  return compareAscending(left.id, right.id);
}

export function sortGamesByRanking<T extends GameRankingInput>(
  games: readonly T[],
  mode: GameRankingMode
): Array<T & GameRankingPosition> {
  return games
    .map((game) => ({ ...game, ...toGameRankingPosition(game) }))
    .sort((left, right) => compareGameRankingPositions(left, right, mode));
}

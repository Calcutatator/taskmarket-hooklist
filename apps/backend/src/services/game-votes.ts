import { createHash, randomUUID } from 'node:crypto';
import type { GameVoteResponse, GameVoteValue } from '@taskmarket/shared';
import { and, eq, isNotNull } from 'drizzle-orm';

import type { db as DbType } from '../db/client';
import { gameVoteRateLimits, gameVotes, games } from '../db/schema';
import { consumeSlidingWindowAttempt, type Transaction } from '../lib/rate-limit';

type Database = Pick<typeof DbType, 'select' | 'transaction'>;

export const GAME_VOTE_RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
export const GAME_VOTE_RATE_LIMIT_PER_USER = 30;
export const GAME_VOTE_RATE_LIMIT_PER_IP = 120;

export class GameVoteError extends Error {
  constructor(
    readonly code: 'NOT_FOUND',
    message: string
  ) {
    super(message);
    this.name = 'GameVoteError';
  }
}

export class GameVoteRateLimitedError extends Error {
  constructor() {
    super('Too many vote attempts. Try again later.');
    this.name = 'GameVoteRateLimitedError';
  }
}

// A rate-limit outage must never let a vote through. Keep the public message intentionally
// generic rather than exposing database implementation details.
export class GameVoteRateLimitUnavailableError extends Error {
  constructor() {
    super('Voting is temporarily unavailable. Try again later.');
    this.name = 'GameVoteRateLimitUnavailableError';
  }
}

function voteRateLimitKey(kind: 'ip' | 'user', value: string): string {
  return createHash('sha256').update(`slap-chop-game-vote:${kind}:${value}`).digest('hex');
}

function normalizedClientAddress(value: string | undefined): string {
  const address = value?.trim().toLowerCase();
  if (!address) {
    throw new GameVoteRateLimitUnavailableError();
  }
  return address;
}

function asGameVoteValue(value: number | null): GameVoteValue | null {
  if (value === null) return null;
  if (value === -1 || value === 1) return value;
  throw new Error('Game vote row has an invalid value');
}

function serializeVoteResponse(input: {
  downvoteCount: number;
  gameId: string;
  selectedVote: GameVoteValue | null;
  upvoteCount: number;
}): GameVoteResponse {
  return {
    gameId: input.gameId,
    upvoteCount: input.upvoteCount,
    downvoteCount: input.downvoteCount,
    netVotes: input.upvoteCount - input.downvoteCount,
    selectedVote: input.selectedVote,
  };
}

// Implements: ADR-0089. The shared module performs the atomic upsert. User and trusted-IP
// limits are deliberately separate keys, so either exhausted dimension rejects the write.
// Any storage exception becomes an unavailable vote endpoint and rolls the surrounding
// transaction back, which is the required fail-closed posture.
export async function enforceGameVoteRateLimit(input: {
  clientAddress: string | undefined;
  privyUserId: string;
  tx: Transaction;
}): Promise<void> {
  const clientAddress = normalizedClientAddress(input.clientAddress);

  try {
    const userResult = await consumeSlidingWindowAttempt(input.tx, {
      table: gameVoteRateLimits,
      key: voteRateLimitKey('user', input.privyUserId),
      windowSeconds: GAME_VOTE_RATE_LIMIT_WINDOW_SECONDS,
      limit: GAME_VOTE_RATE_LIMIT_PER_USER,
    });
    if (userResult.overLimit) throw new GameVoteRateLimitedError();

    const ipResult = await consumeSlidingWindowAttempt(input.tx, {
      table: gameVoteRateLimits,
      key: voteRateLimitKey('ip', clientAddress),
      windowSeconds: GAME_VOTE_RATE_LIMIT_WINDOW_SECONDS,
      limit: GAME_VOTE_RATE_LIMIT_PER_IP,
    });
    if (ipResult.overLimit) throw new GameVoteRateLimitedError();
  } catch (error) {
    if (error instanceof GameVoteRateLimitedError) throw error;
    if (error instanceof GameVoteRateLimitUnavailableError) throw error;
    throw new GameVoteRateLimitUnavailableError();
  }
}

// Implements: ADR-0089. This authenticated read is the client reconciliation source: it joins
// the current user's canonical `game_votes` row with the public cached totals in one statement.
export async function getGameVoteState(
  db: Pick<Database, 'select'>,
  input: { gameId: string; privyUserId: string }
): Promise<GameVoteResponse> {
  const rows = await db
    .select({
      downvoteCount: games.downvoteCount,
      gameId: games.id,
      selectedVote: gameVotes.value,
      upvoteCount: games.upvoteCount,
    })
    .from(games)
    .leftJoin(
      gameVotes,
      and(eq(gameVotes.gameId, games.id), eq(gameVotes.privyUserId, input.privyUserId))
    )
    .where(
      and(eq(games.id, input.gameId), eq(games.status, 'published'), isNotNull(games.publishedAt))
    )
    .limit(1);
  const game = rows[0];

  if (!game) throw new GameVoteError('NOT_FOUND', 'Game not found');

  return serializeVoteResponse({
    downvoteCount: game.downvoteCount,
    gameId: game.gameId,
    selectedVote: asGameVoteValue(game.selectedVote),
    upvoteCount: game.upvoteCount,
  });
}

// Implements: ADR-0089. The game row is locked before reading or changing its vote rows. Every
// public mutation takes that same lock, so concurrent add/remove/replace requests for one game
// serialize. The canonical vote rows are then counted before the cached totals are written,
// keeping the cache repairable and correct in the same transaction.
export async function setGameVote(
  db: Database,
  input: {
    clientAddress: string | undefined;
    gameId: string;
    privyUserId: string;
    value: GameVoteValue;
  }
): Promise<GameVoteResponse> {
  return db.transaction(async (tx) => {
    await enforceGameVoteRateLimit({
      clientAddress: input.clientAddress,
      privyUserId: input.privyUserId,
      tx,
    });

    const lockedGames = await tx
      .select({ id: games.id })
      .from(games)
      .where(
        and(eq(games.id, input.gameId), eq(games.status, 'published'), isNotNull(games.publishedAt))
      )
      .limit(1)
      .for('update');
    const game = lockedGames[0];
    if (!game) throw new GameVoteError('NOT_FOUND', 'Game not found');

    const existingVotes = await tx
      .select({ id: gameVotes.id, value: gameVotes.value })
      .from(gameVotes)
      .where(and(eq(gameVotes.gameId, game.id), eq(gameVotes.privyUserId, input.privyUserId)))
      .limit(1);
    const existing = existingVotes[0];
    const existingValue = asGameVoteValue(existing?.value ?? null);
    const now = new Date();

    if (existing && existingValue === input.value) {
      await tx.delete(gameVotes).where(eq(gameVotes.id, existing.id));
    } else if (existing) {
      await tx
        .update(gameVotes)
        .set({ updatedAt: now, value: input.value })
        .where(eq(gameVotes.id, existing.id));
    } else {
      await tx.insert(gameVotes).values({
        gameId: game.id,
        id: randomUUID(),
        privyUserId: input.privyUserId,
        value: input.value,
      });
    }

    const canonicalVotes = await tx
      .select({ privyUserId: gameVotes.privyUserId, value: gameVotes.value })
      .from(gameVotes)
      .where(eq(gameVotes.gameId, game.id));
    let downvoteCount = 0;
    let selectedVote: GameVoteValue | null = null;
    let upvoteCount = 0;

    for (const vote of canonicalVotes) {
      const value = asGameVoteValue(vote.value);
      if (value === 1) upvoteCount += 1;
      if (value === -1) downvoteCount += 1;
      if (vote.privyUserId === input.privyUserId) selectedVote = value;
    }

    const updatedGames = await tx
      .update(games)
      .set({ downvoteCount, updatedAt: now, upvoteCount })
      .where(eq(games.id, game.id))
      .returning({
        downvoteCount: games.downvoteCount,
        gameId: games.id,
        upvoteCount: games.upvoteCount,
      });
    const updated = updatedGames[0];
    if (!updated) throw new GameVoteError('NOT_FOUND', 'Game not found');

    return serializeVoteResponse({ ...updated, selectedVote });
  });
}

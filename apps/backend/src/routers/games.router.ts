import {
  GameDetailResponseSchema,
  GameGetInputSchema,
  GameListInputSchema,
  GameListResponseSchema,
  GameVoteInputSchema,
  GameVoteResponseSchema,
  GameVoteStateInputSchema,
  type GameCatalogItem,
} from '@taskmarket/shared';
import { TRPCError } from '@trpc/server';
import { and, eq, ilike, isNotNull, or, sql } from 'drizzle-orm';

import { getServerConfig } from '../config/env';
import { artifacts, games, tasks } from '../db/schema';
import { requireSlapChopVoter } from '../lib/slap-chop-voter-auth';
import {
  logSlapChopArtifactDeliveryFailure,
  logSlapChopCatalogRead,
  logSlapChopVote,
  logSlapChopVoteFailure,
  logSlapChopVoteState,
  logSlapChopVoteStateFailure,
  slapChopDurationMs,
  type SlapChopVoteFailureReason,
} from '../lib/slap-chop-observability';
import { getGameDeliveryUrl } from '../services/game-delivery';
import {
  compareGameRankingPositions,
  sortGamesByRanking,
  type GameRankingMode,
  type GameRankingPosition,
} from '../services/game-ranking';
import {
  GameVoteError,
  GameVoteRateLimitUnavailableError,
  GameVoteRateLimitedError,
  getGameVoteState,
  setGameVote,
} from '../services/game-votes';
import { publicProcedure, router } from '../trpc';

type CatalogGameRow = {
  artifactId: string;
  artifactKeccak256Hash: string;
  artifactMimeType: string;
  artifactSha256Hash: string;
  artifactSizeBytes: number;
  coverAltText: string | null;
  coverStorageUri: string | null;
  creatorName: string | null;
  description: string | null;
  downvoteCount: number;
  id: string;
  publishedAt: Date;
  slug: string;
  submissionId: string;
  tags: string[];
  taskId: string;
  taskDescription: string;
  title: string;
  upvoteCount: number;
};

type DetailGameRow = CatalogGameRow & {
  selectedArtifactKeccak256Hash: string;
  selectedArtifactMimeType: string;
  selectedArtifactSha256Hash: string;
  selectedArtifactSizeBytes: number;
  selectedArtifactStorageUri: string;
  selectedArtifactSubmissionId: string;
  selectedArtifactTaskId: string;
};

type HotCursor = {
  hotScore: number;
  id: string;
  mode: 'hot';
  netVotes: number;
  publishedAt: string;
  query: string | null;
  version: 1;
};

type NewCursor = {
  id: string;
  mode: 'new';
  publishedAt: string;
  query: string | null;
  version: 1;
};

type CatalogCursor = HotCursor | NewCursor;

function invalidCursor(): never {
  throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid games catalog cursor' });
}

function gameVoteError(error: unknown): never {
  if (error instanceof GameVoteError) {
    throw new TRPCError({ code: error.code, message: error.message });
  }
  if (error instanceof GameVoteRateLimitedError) {
    throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: error.message });
  }
  if (error instanceof GameVoteRateLimitUnavailableError) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
  }
  throw error;
}

function parseCursorPosition(cursor: CatalogCursor): GameRankingPosition {
  const publishedAt = new Date(cursor.publishedAt);
  if (!Number.isFinite(publishedAt.getTime())) invalidCursor();

  if (cursor.mode === 'hot') {
    if (!Number.isFinite(cursor.hotScore) || !Number.isInteger(cursor.netVotes)) invalidCursor();
    return {
      id: cursor.id,
      publishedAt,
      hotScore: cursor.hotScore,
      netVotes: cursor.netVotes,
    };
  }

  return { id: cursor.id, publishedAt, hotScore: 0, netVotes: 0 };
}

function decodeCatalogCursor(
  encoded: string | undefined,
  expected: { mode: GameRankingMode; query: string | null }
): GameRankingPosition | null {
  if (!encoded) return null;

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return invalidCursor();
  }

  if (
    !decoded ||
    typeof decoded !== 'object' ||
    !('version' in decoded) ||
    decoded.version !== 1 ||
    !('mode' in decoded) ||
    (decoded.mode !== 'hot' && decoded.mode !== 'new') ||
    decoded.mode !== expected.mode ||
    !('query' in decoded) ||
    decoded.query !== expected.query ||
    !('id' in decoded) ||
    typeof decoded.id !== 'string' ||
    decoded.id.length === 0 ||
    !('publishedAt' in decoded) ||
    typeof decoded.publishedAt !== 'string'
  ) {
    return invalidCursor();
  }

  if (decoded.mode === 'hot') {
    if (
      !('hotScore' in decoded) ||
      typeof decoded.hotScore !== 'number' ||
      !('netVotes' in decoded) ||
      typeof decoded.netVotes !== 'number'
    ) {
      return invalidCursor();
    }
    return parseCursorPosition(decoded as HotCursor);
  }

  return parseCursorPosition(decoded as NewCursor);
}

function encodeCatalogCursor(
  game: GameRankingPosition,
  mode: GameRankingMode,
  query: string | null
): string {
  const common = {
    version: 1 as const,
    mode,
    query,
    id: game.id,
    publishedAt: game.publishedAt.toISOString(),
  };
  const cursor: CatalogCursor =
    mode === 'hot'
      ? { ...common, mode: 'hot', hotScore: game.hotScore, netVotes: game.netVotes }
      : { ...common, mode: 'new' };

  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function normalizeQuery(query: string | undefined): string | null {
  return query ? query.toLowerCase() : null;
}

async function serializeCatalogGame(row: CatalogGameRow): Promise<GameCatalogItem> {
  const cover = await getGameDeliveryUrl(row.coverStorageUri, { operation: 'catalog_cover' });

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    creatorName: row.creatorName,
    tags: row.tags,
    taskDescription: row.taskDescription,
    coverUrl: cover?.url ?? null,
    coverAltText: row.coverAltText,
    upvoteCount: row.upvoteCount,
    downvoteCount: row.downvoteCount,
    netVotes: row.upvoteCount - row.downvoteCount,
    publishedAt: row.publishedAt.toISOString(),
  };
}

function isExactPinnedArtifact(row: DetailGameRow): boolean {
  return (
    row.selectedArtifactTaskId === row.taskId &&
    row.selectedArtifactSubmissionId === row.submissionId &&
    row.selectedArtifactSha256Hash === row.artifactSha256Hash &&
    row.selectedArtifactKeccak256Hash === row.artifactKeccak256Hash &&
    row.selectedArtifactMimeType === row.artifactMimeType &&
    row.selectedArtifactSizeBytes === row.artifactSizeBytes
  );
}

function voteFailureReason(error: unknown): SlapChopVoteFailureReason {
  if (error instanceof GameVoteError) return 'not_found';
  if (error instanceof GameVoteRateLimitedError) return 'rate_limited';
  if (error instanceof GameVoteRateLimitUnavailableError) return 'rate_limit_unavailable';
  if (error instanceof TRPCError && error.code === 'UNAUTHORIZED') return 'unauthorized';
  return 'internal';
}

function voteLabel(value: -1 | 1 | null): 'cleared' | 'down' | 'up' {
  if (value === null) return 'cleared';
  return value === 1 ? 'up' : 'down';
}

const catalogGameSelection = {
  id: games.id,
  slug: games.slug,
  title: games.title,
  description: games.description,
  creatorName: games.creatorName,
  tags: games.tags,
  taskId: games.taskId,
  taskDescription: tasks.description,
  submissionId: games.submissionId,
  artifactId: games.artifactId,
  artifactSha256Hash: games.artifactSha256Hash,
  artifactKeccak256Hash: games.artifactKeccak256Hash,
  artifactMimeType: games.artifactMimeType,
  artifactSizeBytes: games.artifactSizeBytes,
  coverStorageUri: games.coverStorageUri,
  coverAltText: games.coverAltText,
  upvoteCount: games.upvoteCount,
  downvoteCount: games.downvoteCount,
  publishedAt: games.publishedAt,
};

// Implements: ADR-0087 (catalog-specific DTOs and immutable source pins).
// Verifies: ADR-0090 through the shared ranking service and fixed ranking vectors.
export const gamesRouter = router({
  list: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/games',
        tags: ['Games'],
        summary: 'List published Slap-Chop Games catalog entries',
      },
    })
    .input(GameListInputSchema)
    .output(GameListResponseSchema)
    .query(async ({ input, ctx }) => {
      const startedAt = performance.now();
      const mode = getServerConfig().SLAP_CHOP_RANKING_MODE;
      const query = normalizeQuery(input.query);
      try {
        const cursor = decodeCatalogCursor(input.cursor, { mode, query });
        const conditions = [eq(games.status, 'published'), isNotNull(games.publishedAt)];

        if (query) {
          const wildcard = `%${query}%`;
          conditions.push(
            or(
              ilike(games.title, wildcard),
              ilike(games.creatorName, wildcard),
              ilike(tasks.description, wildcard),
              sql`array_to_string(${games.tags}, ' ') ILIKE ${wildcard}`
            )!
          );
        }

        const rows = (await ctx.db
          .select(catalogGameSelection)
          .from(games)
          .innerJoin(tasks, eq(games.taskId, tasks.id))
          .where(and(...conditions))) as CatalogGameRow[];

        const ranked = sortGamesByRanking(rows, mode);
        const afterCursor = cursor
          ? ranked.filter((game) => compareGameRankingPositions(game, cursor, mode) > 0)
          : ranked;
        const hasMore = afterCursor.length > input.limit;
        const page = hasMore ? afterCursor.slice(0, input.limit) : afterCursor;
        const serializedGames = await Promise.all(page.map((game) => serializeCatalogGame(game)));
        const artifactDeliveryUnavailableCount = page.filter(
          (game, index) =>
            game.coverStorageUri !== null && serializedGames[index]?.coverUrl === null
        ).length;

        logSlapChopCatalogRead({
          artifactDeliveryUnavailableCount,
          durationMs: slapChopDurationMs(startedAt),
          hasCursor: Boolean(cursor),
          hasMore,
          hasSearchQuery: Boolean(query),
          operation: 'list',
          outcome: 'success',
          rankingMode: mode,
          resultCount: serializedGames.length,
        });

        return {
          games: serializedGames,
          nextCursor:
            hasMore && page.at(-1) ? encodeCatalogCursor(page.at(-1)!, mode, query) : null,
        };
      } catch (error) {
        logSlapChopCatalogRead({
          artifactDeliveryUnavailableCount: 0,
          durationMs: slapChopDurationMs(startedAt),
          hasCursor: Boolean(input.cursor),
          hasMore: false,
          hasSearchQuery: Boolean(query),
          operation: 'list',
          outcome: 'failure',
          rankingMode: mode,
          resultCount: 0,
        });
        throw error;
      }
    }),

  get: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/games/{slug}',
        tags: ['Games'],
        summary: 'Get one published Slap-Chop Game by slug',
      },
    })
    .input(GameGetInputSchema)
    .output(GameDetailResponseSchema.nullable())
    .query(async ({ input, ctx }) => {
      const startedAt = performance.now();
      try {
        const rows = (await ctx.db
          .select({
            ...catalogGameSelection,
            selectedArtifactStorageUri: artifacts.storageUri,
            selectedArtifactTaskId: artifacts.taskId,
            selectedArtifactSubmissionId: artifacts.submissionId,
            selectedArtifactSha256Hash: artifacts.sha256Hash,
            selectedArtifactKeccak256Hash: artifacts.keccak256Hash,
            selectedArtifactMimeType: artifacts.mimeType,
            selectedArtifactSizeBytes: artifacts.sizeBytes,
          })
          .from(games)
          .innerJoin(artifacts, eq(games.artifactId, artifacts.id))
          .innerJoin(tasks, eq(games.taskId, tasks.id))
          .where(
            and(
              eq(games.slug, input.slug),
              eq(games.status, 'published'),
              isNotNull(games.publishedAt)
            )
          )
          .limit(1)) as DetailGameRow[];
        const row = rows[0];

        if (!row) {
          logSlapChopCatalogRead({
            artifactDeliveryUnavailableCount: 0,
            durationMs: slapChopDurationMs(startedAt),
            hasCursor: false,
            hasMore: false,
            hasSearchQuery: false,
            operation: 'get',
            outcome: 'not_found',
            resultCount: 0,
          });
          return null;
        }

        const exactPinnedArtifact = isExactPinnedArtifact(row);
        const [game, artifactDelivery] = await Promise.all([
          serializeCatalogGame(row),
          exactPinnedArtifact
            ? getGameDeliveryUrl(row.selectedArtifactStorageUri, { operation: 'catalog_artifact' })
            : null,
        ]);
        const artifactDeliveryUnavailableCount =
          (row.coverStorageUri !== null && game.coverUrl === null ? 1 : 0) +
          (artifactDelivery === null ? 1 : 0);

        if (!exactPinnedArtifact) {
          logSlapChopArtifactDeliveryFailure({
            durationMs: slapChopDurationMs(startedAt),
            operation: 'catalog_artifact',
            reason: 'source_pin_mismatch',
          });
        }
        logSlapChopCatalogRead({
          artifactDeliveryUnavailableCount,
          durationMs: slapChopDurationMs(startedAt),
          hasCursor: false,
          hasMore: false,
          hasSearchQuery: false,
          operation: 'get',
          outcome: 'success',
          resultCount: 1,
        });

        return {
          ...game,
          source: {
            taskId: row.taskId,
            submissionId: row.submissionId,
            artifactId: row.artifactId,
            artifactSha256Hash: row.artifactSha256Hash,
            artifactKeccak256Hash: row.artifactKeccak256Hash,
            artifactMimeType: row.artifactMimeType,
            artifactSizeBytes: row.artifactSizeBytes,
          },
          artifactUrl: artifactDelivery?.url ?? null,
          artifactUrlExpiresAt: artifactDelivery?.expiresAt ?? null,
        };
      } catch (error) {
        logSlapChopCatalogRead({
          artifactDeliveryUnavailableCount: 0,
          durationMs: slapChopDurationMs(startedAt),
          hasCursor: false,
          hasMore: false,
          hasSearchQuery: false,
          operation: 'get',
          outcome: 'failure',
          resultCount: 0,
        });
        throw error;
      }
    }),

  // Implements: ADR-0089. This is an authenticated read, not a legal-exempt write: the catalog
  // remains anonymous while the private selected vote is only available to its Privy user.
  voteState: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/games/{gameId}/vote',
        tags: ['Games'],
        summary: 'Get the authenticated Privy user’s selected Slap-Chop game vote',
      },
    })
    .input(GameVoteStateInputSchema)
    .output(GameVoteResponseSchema)
    .query(async ({ input, ctx }) => {
      const startedAt = performance.now();
      try {
        const privyUserId = await requireSlapChopVoter(ctx.req.headers.authorization);
        const result = await getGameVoteState(ctx.db, { gameId: input.gameId, privyUserId });
        logSlapChopVoteState({ durationMs: slapChopDurationMs(startedAt) });
        return result;
      } catch (error) {
        logSlapChopVoteStateFailure({
          durationMs: slapChopDurationMs(startedAt),
          reason: voteFailureReason(error),
        });
        return gameVoteError(error);
      }
    }),

  // Implements: ADR-0089. The only game mutation intentionally exempted from marketplace legal
  // acceptance. It still requires a verified Privy token and both shared rate-limit dimensions.
  vote: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/games/{gameId}/vote',
        tags: ['Games'],
        summary: 'Add, remove, or replace the authenticated Privy user’s Slap-Chop game vote',
      },
    })
    .input(GameVoteInputSchema)
    .output(GameVoteResponseSchema)
    .mutation(async ({ input, ctx }) => {
      const startedAt = performance.now();
      try {
        const privyUserId = await requireSlapChopVoter(ctx.req.headers.authorization);
        const result = await setGameVote(ctx.db, {
          clientAddress: ctx.req.ip,
          gameId: input.gameId,
          privyUserId,
          value: input.value,
        });
        logSlapChopVote({
          durationMs: slapChopDurationMs(startedAt),
          requestedVote: input.value === 1 ? 'up' : 'down',
          selectedVote: voteLabel(result.selectedVote),
        });
        return result;
      } catch (error) {
        logSlapChopVoteFailure({
          durationMs: slapChopDurationMs(startedAt),
          reason: voteFailureReason(error),
        });
        return gameVoteError(error);
      }
    }),
});

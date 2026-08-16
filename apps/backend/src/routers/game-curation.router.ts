import {
  GameCurationHideInputSchema,
  GameCurationMutationResponseSchema,
  GameCurationPublishInputSchema,
  GameCurationResolveTaskInputSchema,
  GameCurationResolvedTaskSchema,
  GameCurationUpsertInputSchema,
} from '@taskmarket/shared';
import { TRPCError } from '@trpc/server';

import { requireSlapChopCurator } from '../lib/slap-chop-curator-auth';
import {
  logSlapChopCuration,
  logSlapChopCurationFailure,
  slapChopDurationMs,
  type SlapChopCurationFailureReason,
} from '../lib/slap-chop-observability';
import {
  GameCurationError,
  hideGameCuration,
  publishGameCuration,
  resolveTaskForGameCuration,
  serializeCurationGame,
  upsertGameCuration,
} from '../services/game-curation';
import { publicProcedure, router } from '../trpc';

function curationError(error: unknown): never {
  if (error instanceof GameCurationError) {
    throw new TRPCError({ code: error.code, message: error.message });
  }
  throw error;
}

function curationFailureReason(error: unknown): SlapChopCurationFailureReason {
  if (error instanceof GameCurationError) {
    if (error.code === 'BAD_REQUEST') return 'invalid';
    if (error.code === 'CONFLICT') return 'conflict';
    if (error.code === 'NOT_FOUND') return 'not_found';
    return 'precondition_failed';
  }
  if (error instanceof TRPCError) {
    if (error.code === 'UNAUTHORIZED') return 'unauthorized';
    if (error.code === 'FORBIDDEN') return 'forbidden';
    if (error.code === 'NOT_FOUND') return 'not_found';
    if (error.code === 'BAD_REQUEST') return 'invalid';
    if (error.code === 'CONFLICT') return 'conflict';
    if (error.code === 'PRECONDITION_FAILED') return 'precondition_failed';
  }
  return 'internal';
}

async function curatorId(authorization: string | undefined): Promise<string> {
  return requireSlapChopCurator(authorization);
}

// Implements: ADR-0087 and ADR-0088. Every curation action verifies a Privy bearer token and
// exact server allowlist; source identity is pinned through service checks before a game can
// reach the public catalog. No client-side claim, wallet, or email can authorize this control
// plane.
export const gameCurationRouter = router({
  resolveTask: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/games/curation/tasks',
        tags: ['Game Curation'],
        summary: 'Resolve accepted, playable Taskmarket artifacts for Slap-Chop curation',
      },
    })
    .input(GameCurationResolveTaskInputSchema)
    .output(GameCurationResolvedTaskSchema)
    .query(async ({ input, ctx }) => {
      const startedAt = performance.now();
      try {
        await curatorId(ctx.req.headers.authorization);
        const resolution = await resolveTaskForGameCuration(ctx.db, input.reference);
        logSlapChopCuration({
          artifactCount: resolution.submissions.reduce(
            (count, submission) => count + submission.artifacts.length,
            0
          ),
          durationMs: slapChopDurationMs(startedAt),
          operation: 'resolve_task',
          result: resolution.eligible ? 'eligible' : 'ineligible',
        });
        return resolution;
      } catch (error) {
        logSlapChopCurationFailure({
          durationMs: slapChopDurationMs(startedAt),
          operation: 'resolve_task',
          reason: curationFailureReason(error),
        });
        return curationError(error);
      }
    }),

  upsert: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/games/curation',
        tags: ['Game Curation'],
        summary: 'Create or update a Slap-Chop game draft',
      },
    })
    .input(GameCurationUpsertInputSchema)
    .output(GameCurationMutationResponseSchema)
    .mutation(async ({ input, ctx }) => {
      const startedAt = performance.now();
      try {
        const actorPrivyUserId = await curatorId(ctx.req.headers.authorization);
        const game = await upsertGameCuration(ctx.db, actorPrivyUserId, input);
        logSlapChopCuration({
          artifactCount: 0,
          durationMs: slapChopDurationMs(startedAt),
          operation: 'save_draft',
          result: 'draft',
        });
        return { game: serializeCurationGame(game) };
      } catch (error) {
        logSlapChopCurationFailure({
          durationMs: slapChopDurationMs(startedAt),
          operation: 'save_draft',
          reason: curationFailureReason(error),
        });
        return curationError(error);
      }
    }),

  publish: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/games/curation/{gameId}/publish',
        tags: ['Game Curation'],
        summary: 'Publish a verified Slap-Chop game draft',
      },
    })
    .input(GameCurationPublishInputSchema)
    .output(GameCurationMutationResponseSchema)
    .mutation(async ({ input, ctx }) => {
      const startedAt = performance.now();
      try {
        const actorPrivyUserId = await curatorId(ctx.req.headers.authorization);
        const game = await publishGameCuration(ctx.db, actorPrivyUserId, input.gameId);
        logSlapChopCuration({
          artifactCount: 0,
          durationMs: slapChopDurationMs(startedAt),
          operation: 'publish',
          result: 'published',
        });
        return { game: serializeCurationGame(game) };
      } catch (error) {
        logSlapChopCurationFailure({
          durationMs: slapChopDurationMs(startedAt),
          operation: 'publish',
          reason: curationFailureReason(error),
        });
        return curationError(error);
      }
    }),

  hide: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/games/curation/{gameId}/hide',
        tags: ['Game Curation'],
        summary: 'Hide a published Slap-Chop game',
      },
    })
    .input(GameCurationHideInputSchema)
    .output(GameCurationMutationResponseSchema)
    .mutation(async ({ input, ctx }) => {
      const startedAt = performance.now();
      try {
        const actorPrivyUserId = await curatorId(ctx.req.headers.authorization);
        const game = await hideGameCuration(ctx.db, actorPrivyUserId, input.gameId);
        logSlapChopCuration({
          artifactCount: 0,
          durationMs: slapChopDurationMs(startedAt),
          operation: 'hide',
          result: 'hidden',
        });
        return { game: serializeCurationGame(game) };
      } catch (error) {
        logSlapChopCurationFailure({
          durationMs: slapChopDurationMs(startedAt),
          operation: 'hide',
          reason: curationFailureReason(error),
        });
        return curationError(error);
      }
    }),
});

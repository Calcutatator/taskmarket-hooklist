// Implements: ADR-0100

import { randomBytes, randomUUID } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { normalizeAddress } from '@taskmarket/shared';
import { z } from 'zod';

import type { db as DbType } from '../db/client';
import { bookmarkCollections, bookmarks, tasks } from '../db/schema';
import { taskDiscoverable } from '../lib/task-visibility';
import { router, protectedProcedure, publicProcedure } from '../trpc';

const BookmarkEntity = z.enum(['submission', 'task', 'agent']);

/**
 * Opaque and random, never derived from the collection name.
 *
 * A derived slug would let anyone who guessed the derivation confirm the name of an unpublished
 * collection, which is the opposite of private-by-default.
 */
function mintSlug(): string {
  return randomBytes(12).toString('base64url');
}

export const bookmarksRouter = router({
  /**
   * The caller's own bookmarks.
   *
   * Every query here filters on the authenticated address rather than on an id supplied by the
   * caller: ownership is checked, never inferred from an id being hard to guess.
   */
  list: protectedProcedure
    .input(
      z
        .object({
          collectionId: z.string().optional(),
          entityType: BookmarkEntity.optional(),
          limit: z.number().min(1).max(100).optional().default(50),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const owner = normalizeAddress(ctx.caller!.address);
      const conditions = [eq(bookmarks.ownerAddress, owner)];
      if (input?.collectionId) {
        conditions.push(eq(bookmarks.collectionId, input.collectionId));
      }
      if (input?.entityType) {
        conditions.push(eq(bookmarks.entityType, input.entityType));
      }

      const rows = await ctx.db
        .select()
        .from(bookmarks)
        .where(and(...conditions))
        .orderBy(desc(bookmarks.createdAt))
        .limit(input?.limit ?? 50);

      return {
        bookmarks: rows.map((row) => ({
          collectionId: row.collectionId,
          createdAt: row.createdAt.toISOString(),
          entityId: row.entityId,
          entityType: row.entityType,
          id: row.id,
          note: row.note,
        })),
      };
    }),

  add: protectedProcedure
    .input(
      z.object({
        collectionId: z.string().optional(),
        entityId: z.string().min(1),
        entityType: BookmarkEntity,
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const owner = normalizeAddress(ctx.caller!.address);

      if (input.collectionId) {
        await assertOwnedCollection(ctx.db, owner, input.collectionId);
      }

      // Idempotent by the (owner, entity) unique index: a double-tap on the bookmark control
      // returns the existing row rather than erroring or duplicating.
      //
      // On conflict this updates rather than doing nothing, because the uniqueness is on
      // (owner, entity) and not on the collection. "Save this to Weather picks" for something
      // already bookmarked elsewhere is a request to move it, and doing nothing would leave the
      // user staring at an empty collection having been told the save succeeded. Only the fields
      // the caller actually supplied are written, so a plain re-bookmark does not silently strip
      // an existing collection or note.
      const patch: { collectionId?: string; note?: string } = {};
      if (input.collectionId !== undefined) patch.collectionId = input.collectionId;
      if (input.note !== undefined) patch.note = input.note;

      const [row] = await ctx.db
        .insert(bookmarks)
        .values({
          collectionId: input.collectionId ?? null,
          entityId: input.entityId,
          entityType: input.entityType,
          id: randomUUID(),
          note: input.note ?? null,
          ownerAddress: owner,
        })
        .onConflictDoUpdate({
          target: [bookmarks.ownerAddress, bookmarks.entityType, bookmarks.entityId],
          // An empty patch would be an invalid UPDATE, so fall back to a no-op self-assignment.
          set: Object.keys(patch).length > 0 ? patch : { ownerAddress: owner },
        })
        .returning();

      return { bookmarked: true, id: row.id };
    }),

  remove: protectedProcedure
    .input(z.object({ entityId: z.string().min(1), entityType: BookmarkEntity }))
    .mutation(async ({ ctx, input }) => {
      const owner = normalizeAddress(ctx.caller!.address);
      const removed = await ctx.db
        .delete(bookmarks)
        .where(
          and(
            eq(bookmarks.ownerAddress, owner),
            eq(bookmarks.entityType, input.entityType),
            eq(bookmarks.entityId, input.entityId)
          )
        )
        .returning({ id: bookmarks.id });

      return { removed: removed.length > 0 };
    }),

  createCollection: protectedProcedure
    .input(z.object({ name: z.string().trim().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      const owner = normalizeAddress(ctx.caller!.address);
      const [created] = await ctx.db
        .insert(bookmarkCollections)
        .values({ id: randomUUID(), name: input.name, ownerAddress: owner })
        .returning();

      return { collection: { id: created.id, name: created.name, publishedSlug: null } };
    }),

  listCollections: protectedProcedure.query(async ({ ctx }) => {
    const owner = normalizeAddress(ctx.caller!.address);
    const rows = await ctx.db
      .select()
      .from(bookmarkCollections)
      .where(eq(bookmarkCollections.ownerAddress, owner))
      .orderBy(desc(bookmarkCollections.createdAt));

    return {
      collections: rows.map((row) => ({
        id: row.id,
        name: row.name,
        publishedSlug: row.publishedSlug,
      })),
    };
  }),

  publishCollection: protectedProcedure
    .input(z.object({ collectionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const owner = normalizeAddress(ctx.caller!.address);
      const collection = await assertOwnedCollection(ctx.db, owner, input.collectionId);

      // Already published keeps its slug: re-publishing must not invalidate a link the owner has
      // already handed out.
      if (collection.publishedSlug) return { slug: collection.publishedSlug };

      const slug = mintSlug();
      await ctx.db
        .update(bookmarkCollections)
        .set({ publishedSlug: slug })
        .where(eq(bookmarkCollections.id, input.collectionId));

      return { slug };
    }),

  unpublishCollection: protectedProcedure
    .input(z.object({ collectionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const owner = normalizeAddress(ctx.caller!.address);
      await assertOwnedCollection(ctx.db, owner, input.collectionId);

      // Cleared permanently rather than parked. A slug is never reissued, so a link the owner
      // has revoked cannot be brought back to life by a later collection reusing it.
      await ctx.db
        .update(bookmarkCollections)
        .set({ publishedSlug: null })
        .where(eq(bookmarkCollections.id, input.collectionId));

      return { unpublished: true };
    }),

  /**
   * Read a published collection.
   *
   * Public and unauthenticated, and therefore an enumeration surface -- which is why the slug is
   * random rather than derived.
   *
   * Entries resolve under the **viewer's** permissions, never the owner's. Publishing conveys a
   * curated list, never access to what is in it: getting this backwards would turn publishing
   * into an access-granting operation, which is the highest-severity failure available here.
   * Anything the viewer may not see is omitted silently, with no count and no placeholder, since
   * "3 private items hidden" would confirm the existence and volume of work they cannot see.
   */
  collectionBySlug: publicProcedure
    .input(z.object({ slug: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [collection] = await ctx.db
        .select()
        .from(bookmarkCollections)
        .where(eq(bookmarkCollections.publishedSlug, input.slug))
        .limit(1);

      if (!collection) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Collection not found' });
      }

      const rows = await ctx.db
        .select()
        .from(bookmarks)
        .where(eq(bookmarks.collectionId, collection.id))
        .orderBy(desc(bookmarks.createdAt));

      const taskIds = rows.filter((row) => row.entityType === 'task').map((row) => row.entityId);

      // The visibility filter is the same predicate the public listing uses, so a task that is
      // unlisted or private for this viewer is simply not in the result -- the collection does
      // not get its own parallel notion of what is visible.
      const visibleTaskIds =
        taskIds.length > 0
          ? new Set(
              (
                await ctx.db
                  .select({ id: tasks.id })
                  .from(tasks)
                  .where(and(inArray(tasks.id, taskIds), taskDiscoverable))
              ).map((row) => row.id)
            )
          : new Set<string>();

      return {
        entries: rows
          .filter((row) => (row.entityType === 'task' ? visibleTaskIds.has(row.entityId) : true))
          .map((row) => ({
            entityId: row.entityId,
            entityType: row.entityType,
            note: row.note,
          })),
        name: collection.name,
      };
    }),
});

/**
 * Resolve a collection the caller owns, or refuse.
 *
 * Ownership is asserted on every mutation rather than inferred from the id being a UUID: address
 * B must not be able to touch address A's collection by supplying its id.
 */
async function assertOwnedCollection(
  db: Pick<typeof DbType, 'select'>,
  owner: string,
  collectionId: string
): Promise<typeof bookmarkCollections.$inferSelect> {
  const [collection] = await db
    .select()
    .from(bookmarkCollections)
    .where(
      and(eq(bookmarkCollections.id, collectionId), eq(bookmarkCollections.ownerAddress, owner))
    )
    .limit(1);

  if (!collection) {
    // Deliberately NOT_FOUND rather than FORBIDDEN: distinguishing them would tell address B that
    // a collection it cannot touch exists.
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Collection not found' });
  }

  return collection;
}

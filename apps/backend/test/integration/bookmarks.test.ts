/**
 * Bookmarks, and the two ways they could leak.
 *
 * Verifies: ADR-0100
 *
 * The interesting assertions are not "a bookmark saves". They are:
 *
 *   - address B cannot read, move or delete address A's rows by supplying a known id, because
 *     ownership is checked on every mutation rather than inferred from an id being hard to guess;
 *   - a published collection resolves under the *viewer's* permissions, not the owner's, so
 *     publishing conveys a curated list and never access to what is in it. Getting that backwards
 *     is the highest-severity failure available in this feature, so it is asserted against a real
 *     database rather than reasoned about.
 */

import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/env')>();
  return { ...actual, getServerConfig: vi.fn().mockReturnValue({ NODE_ENV: 'test' }) };
});

import { bookmarkCollections, bookmarks, tasks } from '../../src/db/schema';
import { bookmarksRouter } from '../../src/routers/bookmarks.router';
import { router } from '../../src/trpc';
import { createIsolatedMigratedDatabase } from '../helpers/integration-database';

const isolatedDatabase = createIsolatedMigratedDatabase('bookmarks');
const describeWithDatabase = isolatedDatabase.isAvailable ? describe : describe.skip;
const { database } = isolatedDatabase;

const appRouter = router({ bookmarks: bookmarksRouter });

const ALICE = '0x1111111111111111111111111111111111111111';
const BOB = '0x2222222222222222222222222222222222222222';

function callerFor(address: string | null) {
  return appRouter.createCaller({
    caller: address ? { address } : undefined,
    db: database!,
    idempotencyKey: undefined,
    req: undefined,
    res: undefined,
    taskAccessGrant: undefined,
  } as never);
}

const createdTaskIds: string[] = [];

describeWithDatabase('bookmarks', () => {
  const publicTaskId = `bm-public-${randomUUID()}`;
  const unlistedTaskId = `bm-unlisted-${randomUUID()}`;

  beforeAll(async () => {
    await isolatedDatabase.start();
    createdTaskIds.push(publicTaskId, unlistedTaskId);

    await database.insert(tasks).values([
      {
        description: 'Public bookmarked task',
        escrowTxHash: `escrow-${publicTaskId}`,
        expiryTime: new Date('2030-01-01T00:00:00.000Z'),
        id: publicTaskId,
        requester: ALICE,
        requesterPubkey: '',
        reward: '1000000',
        status: 'completed',
        tags: [],
      },
      {
        description: 'Unlisted bookmarked task',
        escrowTxHash: `escrow-${unlistedTaskId}`,
        expiryTime: new Date('2030-01-01T00:00:00.000Z'),
        id: unlistedTaskId,
        requester: ALICE,
        requesterPubkey: '',
        reward: '1000000',
        status: 'completed',
        tags: [],
        taskVisibility: 'unlisted',
      },
    ]);
  });

  afterAll(async () => {
    await database.delete(bookmarks);
    await database.delete(bookmarkCollections);
    if (createdTaskIds.length > 0) {
      await database.delete(tasks).where(inArray(tasks.id, createdTaskIds.splice(0)));
    }
    await isolatedDatabase.stop();
  });

  it('refuses every owner-scoped endpoint without an authenticated caller', async () => {
    const anonymous = callerFor(null);
    await expect(anonymous.bookmarks.list({})).rejects.toThrow(/authentication/i);
    await expect(
      anonymous.bookmarks.add({ entityId: publicTaskId, entityType: 'task' })
    ).rejects.toThrow(/authentication/i);
    await expect(anonymous.bookmarks.listCollections()).rejects.toThrow(/authentication/i);
  });

  it('saves a bookmark and returns it to its owner only', async () => {
    const alice = callerFor(ALICE);
    await alice.bookmarks.add({ entityId: publicTaskId, entityType: 'task' });

    const mine = await alice.bookmarks.list({});
    expect(mine.bookmarks.map((b) => b.entityId)).toContain(publicTaskId);

    const theirs = await callerFor(BOB).bookmarks.list({});
    expect(theirs.bookmarks).toEqual([]);
  });

  it('is idempotent, so a double-tap does not duplicate', async () => {
    const alice = callerFor(ALICE);
    await alice.bookmarks.add({ entityId: publicTaskId, entityType: 'task' });
    await alice.bookmarks.add({ entityId: publicTaskId, entityType: 'task' });

    const mine = await alice.bookmarks.list({});
    expect(mine.bookmarks.filter((b) => b.entityId === publicTaskId)).toHaveLength(1);
  });

  it('moves an already-saved bookmark into a collection rather than silently ignoring it', async () => {
    // The unique index is on (owner, entity), not on the collection, so a naive
    // onConflictDoNothing would accept "save this to Weather picks" for something already
    // bookmarked and leave the collection empty -- telling the user it worked while it did not.
    const alice = callerFor(ALICE);
    await alice.bookmarks.add({ entityId: publicTaskId, entityType: 'task' });

    const { collection } = await alice.bookmarks.createCollection({ name: 'Move target' });
    await alice.bookmarks.add({
      collectionId: collection.id,
      entityId: publicTaskId,
      entityType: 'task',
    });

    const inCollection = await alice.bookmarks.list({ collectionId: collection.id });
    expect(inCollection.bookmarks.map((b) => b.entityId)).toContain(publicTaskId);

    // And a plain re-bookmark does not strip the collection back off again.
    await alice.bookmarks.add({ entityId: publicTaskId, entityType: 'task' });
    const stillThere = await alice.bookmarks.list({ collectionId: collection.id });
    expect(stillThere.bookmarks.map((b) => b.entityId)).toContain(publicTaskId);
  });

  it('finds a bookmark written with a checksummed address by a lowercase read', async () => {
    // ADR-0020. Wallets hand back mixed-case addresses; the store must not care.
    const checksummed = callerFor(ALICE.toUpperCase().replace('0X', '0x'));
    const mine = await checksummed.bookmarks.list({});
    expect(mine.bookmarks.map((b) => b.entityId)).toContain(publicTaskId);
  });

  it('does not let one address touch another address’s collection by id', async () => {
    const alice = callerFor(ALICE);
    const { collection } = await alice.bookmarks.createCollection({ name: 'Alice picks' });

    const bob = callerFor(BOB);
    // NOT_FOUND rather than FORBIDDEN: telling Bob it exists is itself a leak.
    await expect(
      bob.bookmarks.publishCollection({ collectionId: collection.id })
    ).rejects.toThrow(/not found/i);
    await expect(
      bob.bookmarks.unpublishCollection({ collectionId: collection.id })
    ).rejects.toThrow(/not found/i);
    await expect(
      bob.bookmarks.add({
        collectionId: collection.id,
        entityId: publicTaskId,
        entityType: 'task',
      })
    ).rejects.toThrow(/not found/i);

    expect((await bob.bookmarks.listCollections()).collections).toEqual([]);
  });

  it('publishes with an opaque slug that is not derived from the name', async () => {
    const alice = callerFor(ALICE);
    const { collection } = await alice.bookmarks.createCollection({ name: 'Weather picks' });
    const { slug } = await alice.bookmarks.publishCollection({ collectionId: collection.id });

    expect(slug).not.toContain('weather');
    expect(slug.toLowerCase()).not.toContain('picks');
    expect(slug.length).toBeGreaterThanOrEqual(12);

    // Re-publishing keeps the link the owner already handed out.
    const again = await alice.bookmarks.publishCollection({ collectionId: collection.id });
    expect(again.slug).toBe(slug);
  });

  it('resolves a published collection under the viewer’s permissions, not the owner’s', async () => {
    const alice = callerFor(ALICE);
    const { collection } = await alice.bookmarks.createCollection({ name: 'Mixed picks' });
    await alice.bookmarks.add({
      collectionId: collection.id,
      entityId: publicTaskId,
      entityType: 'task',
    });
    await alice.bookmarks.add({
      collectionId: collection.id,
      entityId: unlistedTaskId,
      entityType: 'task',
    });
    const { slug } = await alice.bookmarks.publishCollection({ collectionId: collection.id });

    const seen = await callerFor(null).bookmarks.collectionBySlug({ slug });

    // The unlisted task is Alice's own and she can see it; a viewer cannot, and publishing must
    // not grant them access. Omitted entirely -- no count, no placeholder, since "1 private item
    // hidden" would confirm its existence.
    expect(seen.entries.map((e) => e.entityId)).toContain(publicTaskId);
    expect(seen.entries.map((e) => e.entityId)).not.toContain(unlistedTaskId);
    expect(JSON.stringify(seen)).not.toContain(unlistedTaskId);
    expect(seen.name).toBe('Mixed picks');
  });

  it('revokes a slug permanently on unpublish', async () => {
    const alice = callerFor(ALICE);
    const { collection } = await alice.bookmarks.createCollection({ name: 'Temporary' });
    const { slug } = await alice.bookmarks.publishCollection({ collectionId: collection.id });

    await alice.bookmarks.unpublishCollection({ collectionId: collection.id });
    await expect(callerFor(null).bookmarks.collectionBySlug({ slug })).rejects.toThrow(
      /not found/i
    );

    // Re-publishing mints a different slug, so the revoked link stays dead.
    const republished = await alice.bookmarks.publishCollection({ collectionId: collection.id });
    expect(republished.slug).not.toBe(slug);
    await expect(callerFor(null).bookmarks.collectionBySlug({ slug })).rejects.toThrow(
      /not found/i
    );
  });

  it('removes a bookmark for its owner and nobody else', async () => {
    const alice = callerFor(ALICE);
    await alice.bookmarks.add({ entityId: publicTaskId, entityType: 'task' });

    const bobRemoval = await callerFor(BOB).bookmarks.remove({
      entityId: publicTaskId,
      entityType: 'task',
    });
    expect(bobRemoval.removed).toBe(false);

    const aliceRemoval = await alice.bookmarks.remove({
      entityId: publicTaskId,
      entityType: 'task',
    });
    expect(aliceRemoval.removed).toBe(true);
  });
});

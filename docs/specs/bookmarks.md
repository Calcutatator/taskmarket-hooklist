# Bookmarks and collections

> Version: 0.1 | Date: 2026-08-14 | Status: Draft
> **Implements ADRs:** ADR-0100
> Depends on: `docs/specs/shareable-ui-state.md`, `docs/specs/reference-codes.md`

## Purpose

Deep linking makes a screen citable; search makes it findable if you remember a word from it. Neither
helps the case the original complaint actually describes — someone saw something, did not save it, and
now wants it back with only a vague memory. That needs an act of saving at the moment of seeing.

This spec defines bookmarks: wallet-scoped, private by default, groupable into named collections that
can be explicitly published as a shareable URL.

## Design / Architecture

### Scope and identity

A bookmark is a server-side record scoped to a wallet address. It can point at a submission, a task or
an agent — the three things people say "I saw a good one" about.

Reads and writes authenticate through the general read-auth header established by ADR-0023. That
decision converged two narrower self-auth mechanisms (ADR-0015's inbox check, ADR-0017's signed
`myBids` message) onto one header; bookmarks are the same shape of problem — a caller reading and
writing its own data — and introducing a third mechanism would recreate exactly the divergence
ADR-0023 removed.

Addresses are normalized on write per ADR-0020.

### Collections

A bookmark belongs to zero or one collection. Uncollected bookmarks appear in a default "Saved" view
that is not itself a collection and cannot be published.

A collection has a name, an owner, and a publication state. Publishing mints an opaque slug and makes
the collection readable at its own URL; unpublishing revokes the slug permanently rather than parking
it for reuse, so a previously shared link cannot be resurrected by a later collection.

The slug is opaque and randomly generated — not derived from the name, which would otherwise leak the
name of an unpublished collection to anyone who guessed at it.

### Visibility of published collections

A published collection never overrides the visibility of its contents. Rendering it resolves each
entry under the *viewer's* permissions, not the owner's, and omits what the viewer may not see.

Omission is silent. A placeholder saying "3 private items hidden" would confirm the existence and
count of private work to someone who cannot see it, which is the same information leak the `/s/<code>`
resolver is designed to avoid. The collection shows what the viewer can see and says nothing about the
rest.

This means two viewers can see legitimately different versions of the same collection URL. That is
correct, and it is the reason a published collection cannot be cached publicly.

### Naming

The feature is "bookmark", not "favourite". A favourite reads as a public signal, and a public signal
wants to influence ranking; once a count is visible it becomes something to game, and a private
organizational tool has quietly become a reputation input. There are no public counts, and bookmark
data does not feed ranking, reputation or recommendation. This is a product commitment, not just a
label.

### Interaction

- **A bookmark control** sits on each submission, task and agent, using the existing button and icon
  primitives rather than a new control, with an accessible label and a visible pressed state.
- **Requires a connected wallet.** Disconnected, the control prompts to connect rather than silently
  failing or writing to a local store that will later need reconciling — the half-measure ADR-0100
  rejects.
- **Optimistic toggle** with rollback on failure, since the write is small and the latency is visible.
- **`/dashboard/bookmarks`** lists saved items with collection filtering, and its filter, sort and
  collection selection are URL-backed per `shareable-ui-state.md` like every other surface.
- **A bookmarked submission stores its reference code**, so the saved item is displayed and shared by
  its public name.

### Schema

```sql
CREATE TABLE IF NOT EXISTS "bookmark_collections" (
  "id" text PRIMARY KEY,
  "owner_address" text NOT NULL,
  "name" text NOT NULL,
  "published_slug" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "bookmarks" (
  "id" text PRIMARY KEY,
  "owner_address" text NOT NULL,
  "entity_type" text NOT NULL,   -- 'submission' | 'task' | 'agent'
  "entity_id" text NOT NULL,
  "collection_id" text REFERENCES "bookmark_collections"("id"),
  "note" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_bookmarks_owner" ON "bookmarks" ("owner_address");
CREATE UNIQUE INDEX IF NOT EXISTS "bookmarks_owner_entity_unique"
  ON "bookmarks" ("owner_address", "entity_type", "entity_id");
CREATE UNIQUE INDEX IF NOT EXISTS "bookmark_collections_slug_unique"
  ON "bookmark_collections" ("published_slug");
```

The owner/entity unique index makes a double-tap on the bookmark control a no-op rather than a
duplicate row. Per `AGENTS.md`, migrations need matching `meta/_journal.json` entries whose `"when"`
values are re-stamped with a fresh `date +%s000` immediately before merge.

## Interfaces / Contracts

```ts
bookmarks.list({ collectionId?, entityType?, cursor?, limit? })
  -> { bookmarks: Bookmark[], nextCursor: string | null, hasMore: boolean }

bookmarks.add({ entityType, entityId, collectionId?, note? }) -> { bookmark: Bookmark }
bookmarks.remove({ entityType, entityId }) -> { removed: boolean }
bookmarks.move({ bookmarkId, collectionId: string | null }) -> { bookmark: Bookmark }

collections.list() -> { collections: Collection[] }
collections.create({ name }) -> { collection: Collection }
collections.rename({ collectionId, name }) -> { collection: Collection }
collections.publish({ collectionId }) -> { slug: string }
collections.unpublish({ collectionId }) -> { unpublished: boolean }
collections.delete({ collectionId }) -> { deleted: boolean }   // bookmarks survive, uncollected

collections.bySlug({ slug })   // public, unauthenticated; viewer-scoped resolution
  -> { name: string, entries: ResolvedEntry[] }
```

All except `collections.bySlug` require the ADR-0023 read-auth header and operate strictly on the
authenticated address's own rows. Errors carry machine-readable reasons per ADR-0058.

Published collection route: `/c/<slug>`.

## Security & Privacy considerations

- **A bookmark grants no access.** Bookmarking a task the caller can currently see, and later losing
  that access, must not leave the item readable through the bookmark list. Every read resolves through
  the normal visibility path at read time; the bookmark stores a reference, never a copy.
- **A published collection is viewer-scoped, never owner-scoped.** Entries are resolved under the
  viewer's permissions. Getting this backwards would turn publishing into an access-granting
  operation, which is the highest-severity failure available in this spec.
- **Hidden entries are omitted silently**, with no count or placeholder, so a collection cannot be
  used to confirm the existence of private work.
- **Slugs are opaque and random**, not derived from the collection name, so they leak nothing about an
  unpublished collection. Unpublishing revokes permanently; slugs are never reused.
- **`collections.bySlug` is public and unauthenticated**, so it is an enumeration surface and is rate
  limited through the shared module (ADR-0038).
- **Every write is scoped to the authenticated address.** A caller must not be able to read, move or
  delete another address's bookmarks by supplying an id; ownership is checked on every mutation rather
  than inferred from the id being unguessable.
- **Bookmark data is personal interest data** that did not previously exist. It is not shared with
  third parties, does not feed ranking or recommendation, and is deleted with the collection or the
  bookmark rather than retained.
- **Published collections are not publicly cacheable**, since two viewers legitimately see different
  content at the same URL. Cache headers must be private.

## Testing & Verification

1. **Cross-address isolation.** Address B cannot list, read, move or delete address A's bookmarks or
   collections through any endpoint, including by supplying a known id directly.
2. **Auth required.** Every endpoint except `collections.bySlug` rejects an absent, malformed or
   mismatched read-auth header.
3. **Idempotent add.** Adding the same entity twice yields one row and succeeds both times.
4. **Access revocation.** A bookmarked private task that the owner is later removed from stops
   resolving in their own bookmark list, without erroring the whole list.
5. **Viewer-scoped publication.** A collection containing a private task, viewed by a permitted and a
   non-permitted viewer, shows the entry to the first and omits it entirely for the second — with no
   count, placeholder or difference in response shape that reveals the omission.
6. **Slug lifecycle.** Unpublishing makes the slug 404 permanently; republishing mints a different
   slug; a slug is never issued twice.
7. **Slug opacity.** A slug is not derivable from the collection name; renaming a published collection
   does not change its slug.
8. **Collection delete.** Deleting a collection keeps its bookmarks and leaves them uncollected.
9. **Address normalization.** A bookmark written with a checksummed address is found by a lowercase
   read, per ADR-0020.
10. **Migration.** Idempotency and journal tests pass; the migration applies twice cleanly.
11. **UI.** The bookmark control has an accessible label and a visible pressed state, works by
    keyboard, and prompts to connect when disconnected — verified in Storybook at both themes with a
    `play` assertion covering toggle and rollback.
12. **URL contract.** `/dashboard/bookmarks` filter, sort and collection selection round-trip through
    reload per `shareable-ui-state.md`.

## Non-goals

- **No local or anonymous bookmarks.** A connected wallet is required. Whether a pre-connection local
  list should exist, and how it would merge, is left open in the RFC rather than decided here.
- **No public favourite counts, and no ranking, reputation or recommendation input.**
- **No on-chain favourites.**
- **No saved searches.** Bookmarks store things, not queries.
- **No collaborative or multi-owner collections.**
- **No follow, subscribe or notification behavior.** A bookmark is a saved reference, not a watch.
- **No tags or folder hierarchy.** A bookmark belongs to zero or one flat collection.

## References

- RFC: `docs/rfc/0010-shareable-ui-state-and-deep-linking.md`
- ADR: ADR-0100
- Auth reused: ADR-0023, converging ADR-0015 and ADR-0017
- Address normalization: ADR-0020 · Error reasons: ADR-0058 · Rate limiting: ADR-0038
- Visibility rules a published collection must respect: ADR-0014, ADR-0016, ADR-0021, ADR-0030
- URL contract for the bookmarks surface: `docs/specs/shareable-ui-state.md`
- Migration and journal rules: `AGENTS.md`, `docs/DB_GUIDE.md`

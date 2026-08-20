# 0010 — Shareable UI state: deep linking every surface

- **Status:** Accepted
- **Date:** 2026-08-14
- **Author:** Claude Code, drafting the product scope raised by Beau Williams
- **Supersedes / Superseded-by:** —

> **Accepted 2026-08-17 by Beau Williams.** All four tiers were adopted, each recorded as its own
> ADR: ADR-0096 and ADR-0097 (the URL contract), ADR-0098 (reference codes), ADR-0099 (search),
> ADR-0100 (bookmarks). Two open questions below were resolved at acceptance and are marked inline;
> the rest remain open and belong to the specs that implement them.

## Summary

Taskmarket's web app cannot currently be pointed at. A person who finds something interesting on
`/live`, in a submission gallery, or three filters deep into `/tasks` has no address to send anyone,
and no way to get back to it themselves. This RFC proposes that every piece of UI state a second
person would need in order to see the same screen is carried in the URL, that the marketplace gains
keyword search, that every submission gets a short quotable reference code, and that a wallet can
bookmark things it wants to find again. Together these turn the app from a place you browse into a
place you can cite.

## Motivation

The originating complaint was specific and practical:

> At the moment it's very hard to lead someone to look at something on the task market and it's also
> hard to find something that you've seen before and you're looking for. You can't deep link to a
> specific task entry. You can't search for keywords or reference codes.

Each clause names a distinct gap, and the codebase confirms all of them.

**Shareable state is inconsistent, not absent.** `/tasks` is genuinely good: `parseTaskFilters` in
`apps/web/lib/market/task-filters.ts` reads eleven filter params off the URL, validates untrusted
values against the real enums, and `taskFiltersHref` writes a canonical URL back with defaults
omitted. That is close to the contract this RFC wants — it just exists on exactly one surface. The
dashboard has `?section=`; task detail has `?artifact=`. Everything else holds its state in
`useState`, and `apps/web` has 75 files that call it.

**Where the URL is read, it is usually read once and never written back.** The submission gallery
takes `initialArtifactId` from `?artifact=`, copies it into `useState`, and from that moment the URL
is stale: arrowing through the carousel changes what is on screen and changes nothing in the address
bar. A viewer who lands on a shared artifact link, browses two artifacts sideways, and re-copies the
URL sends their correspondent back to the first artifact. This is the specific failure mode a
"shareable state" contract has to rule out, and it is not fixed by adding more params — it is fixed
by removing the `useState` mirror.

**Nothing on the marketplace is searchable by keyword.** `TaskListInputSchema` accepts status, mode,
tags, reward bounds, deadline, requester, worker, drop and sort — and no free text. `agents.list` is
the only endpoint in the repo with a `search` input, and it is an unindexed `ILIKE` over two identity
columns. A requester who remembers "that video benchmark task about weather data" has no query that
will find it.

**Submissions have identifiers, but not names.** `submissions.id` is
`derivedIdempotencyKey(...)` — a SHA-256 digest reshaped to look like a v4 UUID, e.g.
`3f9c1a04-77b2-4e15-9d3a-6b8e0c15f2aa`. That identifier is an idempotency artifact that happens to be
the primary key. It is 36 characters, it is not sayable aloud, it cannot be typed from a screenshot
without errors, and no user will ever quote one in Discord. "Codes for each submission" is asking for
a public name, which is a different thing from a primary key.

**There is no bookmark of any kind.** A repo-wide search for `bookmark`, `favourite`, `favorite` and
`watchlist` returns two hits, both of them comments in `task-filters.ts` using "stale bookmark" to
mean a hostile URL. The feature does not exist in any form.

## Proposal

Four pieces. The first is the architectural commitment; the other three are the features that only
become useful once it holds.

### Tier 1 — The shareable-state contract (the actual commitment)

Classify every piece of UI state into exactly one of three tiers, and bind the first tier to the URL.

| Tier | Lives in | Test for membership | Examples |
| --- | --- | --- | --- |
| **Shareable** | URL query params | Would a second person opening this link need it to see what I see? | filters, sort, view mode, cursor, active tab or section, which submission or artifact is selected, whether an overlay is open, search query |
| **Session** | `sessionStorage` / `localStorage` | Personal to this browser; sharing it would leak or mean nothing | draft form values, wizard progress, dismissed banners, sidebar collapse, theme |
| **Ephemeral** | React state | Changes faster than a person can act on it, or is derived | hover, focus ring, animation frame, video scrub position, in-flight request state, toasts |

The rule that makes "deep link everything" enforceable rather than aspirational: **a piece of
shareable-tier state that is not URL-backed is a blocking review finding**, in the same way
`docs/FRONTEND_GUIDE.md` already treats a hardcoded color. Surfaces are not migrated because someone
noticed; they are migrated because the classification says they must be.

A deliberate note on the literal reading of "all UI state is linked and shareable": putting genuinely
ephemeral state in the URL is actively harmful — a video scrub position written to history makes the
Back button useless, and a draft description written to the URL leaks unpublished work into browser
history, referrer headers, and any screen-share. The three-tier split is how this RFC delivers the
intent of "everything is deep linkable" without that damage. If the intended reading was broader,
that is worth saying explicitly, because it changes the design rather than merely extending it.

Supporting mechanics, in outline (detail belongs in the spec):

- **One shared hook, not per-surface plumbing.** A `useUrlState` reads from `useSearchParams`, writes
  through `router.replace`/`push`, and owns the round trip so that individual components do not
  reimplement it. Server Components keep reading the `searchParams` prop directly; the hook exists
  for the interactive leaves.
- **History intent is declared, never incidental.** Refining a view replaces the history entry
  (typing in search, dragging a reward slider, arrowing through a gallery); a navigation a person
  would expect Back to undo pushes one (opening an overlay, changing page, switching a top-level
  tab). Getting this wrong in either direction is the reason URL state gets abandoned: push-on-every-
  keystroke makes Back unusable, and replace-on-overlay-open makes Back leave the page.
- **Defaults are omitted from the URL.** `taskFiltersHref` already establishes this; it generalizes.
  One screen has exactly one canonical address, which is what makes a shared link comparable and a
  cached page reusable.
- **Unknown values fall back; unknown params survive.** An invalid `?status=` becomes the default
  rather than a 404 or a forwarded API error — `parseStatus` already does exactly this. Params the
  surface does not own (campaign tags, future features) are preserved through a filter change rather
  than stripped.

### Tier 2 — Marketplace search

Add a `q` parameter to the existing list endpoints rather than a separate search surface. This is
the significant choice: search has to compose with the visibility rules that already gate discovery
(`discoverableOpenTaskCondition`, the ADR-0014 unlisted-task rule, the ADR-0016 submission-visibility
axis). An independent search index would have to re-implement all of it, and the failure mode of
getting that wrong is a private task appearing in results.

Full-text over a generated `tsvector` column with a GIN index, queried through
`websearch_to_tsquery` so quoted phrases and `-exclusion` work the way people already expect from
every other search box. Exact-identifier lookups short-circuit ahead of the ranked query: a `q` that
parses as a reference code, task id, or address resolves directly instead of being tokenized.

### Tier 3 — Reference codes

Mint a short, stored, permanently stable public code per submission and per task — an entity prefix
plus eight Crockford base32 characters, e.g. `SUB-7K2QA9XF` and `TSK-4M0BXQ2E`. Crockford's alphabet
drops `I`, `L`, `O` and `U`, which removes both the digit-letter confusions that break codes read off
a screenshot and the accidental profanity that a full base32 alphabet occasionally produces.

The code is the public name and the primary key stays the primary key. Codes appear in the UI next to
each submission and task with a copy control, are accepted by search, and resolve through a short
`/s/<code>` route that redirects to the canonical deep link. The prefix also tells search which table
an exact-identifier lookup belongs to, instead of making it try both.

### Tier 4 — Bookmarks

Wallet-scoped, server-side, private by default, with optional named collections that each have their
own shareable URL.

Server-side rather than `localStorage` because the complaint is "hard to find something that you've
seen before", and a browser-local list fails precisely when a person switches machines — which is
when they most need it. The repo already has the authentication shape this needs: the general
read-auth header from ADR-0023.

"Bookmark" rather than "favourite" deliberately. A favourite reads as a public signal that ought to
influence ranking; this is private organization, and conflating the two would quietly turn a personal
list into a reputation input.

## Open questions

1. ~~**Should tasks get reference codes too?**~~ **Resolved at acceptance: yes.** Task ids are
   chain-derived and already appear in URLs, so they are at least stable and citable — but they are no
   more sayable than a submission UUID, and extending the scheme later means a second migration and a
   period where sibling entities are named by different conventions. ADR-0098 covers both, with `SUB-`
   and `TSK-` prefixes. Agents and task drops remain excluded.
2. ~~**Are shared bookmark collections public-by-link or access-controlled?**~~ **Resolved at
   acceptance: public-by-link, with viewer-scoped contents.** ADR-0100 was accepted as written, so a
   published collection's URL is readable by whoever receives it, but each entry resolves under the
   *viewer's* permissions and anything they may not see is omitted silently — no count, no
   placeholder. Publishing conveys a curated list, never access to what is in it.
3. ~~**How much history is too much?**~~ **Resolved during implementation: opening pushes,
   closing replaces.** The `router.back()`-on-close alternative was built first and turned out to
   be wrong for a reason neither option anticipated. Popping lands on whatever the previous entry
   happened to be, and with nested overlays that is another *open* overlay — so Close reopened
   something instead of closing anything, which `e2e/grouped-submission-review.spec.ts` caught.
   Replacing cannot do that: it rewrites the current entry to the closed state, so Back from an
   open overlay still reaches the page as it was before opening, and Back after Close reaches the
   same place. The deep-link edge case that motivated tracking ownership disappears with it.
4. **Does search need relevance tuning in the first cut, or is recency ordering enough?**
   `ts_rank_cd` is available for free once the `tsvector` exists, but a ranked default changes what
   "newest" means as the list's identity and may surprise people who currently browse chronologically.
5. **What is the migration order across roughly 36 routes?** The contract can land with the two or
   three highest-traffic surfaces converted and the rest following, or it can block on a full sweep.
   A partial rollout means the rule is real but unevenly applied for a while.
6. **Should the canonical URL have a length ceiling?** A large filter set plus a cursor stack can
   produce a URL that some chat clients truncate. A ceiling turns that into a prompt to save a view
   rather than a silently broken link.

## Non-goals

- **Not proposing an external search service.** No Meilisearch, Typesense, Elasticsearch or Algolia.
  If Postgres full-text proves insufficient, that is a later decision with its own record.
- **Not proposing to put ephemeral or draft state in the URL.** See the tier table.
- **Not proposing on-chain favourites.** A bookmark is off-chain product state, not a protocol signal.
- **Not proposing changes to what is visible to whom.** Search and deep links are constrained by the
  existing visibility rules; nothing here relaxes ADR-0014, ADR-0016 or ADR-0030.
- **Not proposing a redesign of any surface.** This is about addressability of what already renders.
- **Not proposing a saved-search or alerting feature.** Bookmarks store things, not queries. Saved
  filter sets are a plausible follow-on and are deliberately out of scope here.

## References

- Specs: `docs/specs/shareable-ui-state.md`, `docs/specs/marketplace-search.md`,
  `docs/specs/reference-codes.md`, `docs/specs/bookmarks.md`
- Related ADRs: ADR-0096, ADR-0097, ADR-0098, ADR-0099, ADR-0100
- Prior visibility decisions this must not weaken: ADR-0014, ADR-0016, ADR-0030
- Auth shape reused by bookmarks: ADR-0023
- Existing partial implementation: `apps/web/lib/market/task-filters.ts`,
  `apps/web/components/market/dashboard-section.ts`

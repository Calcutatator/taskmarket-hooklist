# 0100 — Bookmarks are wallet-scoped server records, private by default

> **Decision (Y-statement):** In the context of users who cannot find work they have already seen,
> facing the choice between a browser-local list and a stored one, we decided to make bookmarks
> wallet-scoped server records read through the existing read-auth header, private by default and
> shareable only as an explicitly published collection, to achieve a list that survives a change of
> device and can be handed to someone else, accepting a new table, an authenticated write path and
> the loss of bookmarking while disconnected.

- **Status:** Accepted
- **Date:** 2026-08-14
- **Accepted:** 2026-08-17
- **Embodiment:** Verified
- **Last audited:** 2026-08-17
- **Author:** Claude Code (drafted for review)
- **Reviewers:** Beau Williams — reviewed at acceptance; no separate independent reviewer recorded
- **Deciders:** Beau Williams
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** —
- **Pending Amends / Amended-by:** —

## Context

Nothing resembling a bookmark exists. A repo-wide search for `bookmark`, `favourite`, `favorite` and
`watchlist` returns two hits, both comments in `task-filters.ts` using "stale bookmark" to describe a
hostile URL.

Half of the originating complaint was "it's hard to find something that you've seen before and you're
looking for". Deep linking (ADR-0096) and search (ADR-0099) address the case where the user can
reconstruct where a thing was, or remembers a word from it. Neither helps the case the complaint
actually describes: a person saw something, did not save it, and now wants it back with nothing but a
vague memory to go on. That needs an act of saving at the moment of seeing.

Where that saved list lives is the decision, and it is decided by when the list is needed. The moment
a person most needs it is when they have moved — a different machine, a different browser, a phone
after a laptop. A browser-local list is empty exactly then. It is also silently destroyed by clearing
site data, which users do routinely and without connecting the two events.

The identity to scope it to is settled by what already exists. The app is wallet-based, and ADR-0023
converged self-authenticated reads onto a general read-auth header after ADR-0017 and ADR-0015 solved
it twice in narrower ways. Bookmarks are the same shape of problem — a caller reading its own data —
and reaching for a third mechanism would repeat exactly the divergence ADR-0023 cleaned up.

Naming carries a design commitment. "Favourite" reads as a public signal, and public signals want to
influence ranking; once a count is visible, it becomes something to game, and a private organizational
tool has quietly turned into a reputation input. The user's original suggestion offered both words.

There is a genuine tension with sharing. A private list is the useful default and satisfies the stated
need. But a curated set of good submissions is exactly the kind of thing someone would want to hand to
another person, and that is close to the "lead someone to look at something" half of the complaint.

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| Wallet-scoped server records, private by default, with optionally published collections | Survives a device change, which is when the feature is actually needed; reuses the ADR-0023 read-auth header; publishing a collection serves the sharing half of the complaint | New table and authenticated write path; cannot bookmark while disconnected; personal interest data now sits on the server |
| `localStorage` only (rejected) | No backend at all; works while disconnected; nothing personal leaves the browser | Empty on a new device, which is the exact moment the feature is needed; silently destroyed by clearing site data; cannot be shared or handed to anyone |
| `localStorage` now, server sync later (rejected) | Ships fast; defers the auth work | Two sources of truth and a merge problem on first sign-in, which is the hardest part done last and under pressure; the shipped version fails at the case that motivated the feature |
| Encode the list in a URL, e.g. `?saved=SUB-A,SUB-B` (rejected) | No storage at all; trivially shareable; consistent with ADR-0096 | The URL must be kept somewhere, which is the original problem restated; unbounded growth; loses the list on any navigation that drops the param |
| On-chain favourites (rejected) | Permanent, portable, verifiable | Gas cost per bookmark for a UI convenience; permanent and public by construction, so an accidental save cannot be undone; makes a private organizational act a broadcast |
| Public favourite counts feeding ranking (rejected) | Social proof; a discovery signal for free | Turns a private tool into something worth gaming; makes every save a public act, which suppresses honest saving |

## Decision

A bookmark is a server-side record scoped to a wallet address, covering submissions, tasks and
agents. Reads and writes authenticate through the general read-auth header established by ADR-0023;
no new authentication mechanism is introduced.

Bookmarks are private by default. A user may group them into a named collection and explicitly
publish that collection, which gives it a shareable URL. Publishing is per-collection, opt-in, and
reversible; an individual bookmark is never independently public.

A published collection never overrides the visibility of what it contains. A viewer sees only the
entries they would already have been permitted to see; anything else is omitted rather than shown as
a blocked placeholder.

The feature is called "bookmark". There are no public counts, and bookmark data does not feed
ranking, reputation or recommendation.

## Consequences

**Positive:**

- The list is there after a device change, a reinstall, or clearing site data — the case that
  motivated the feature.
- Published collections serve the "lead someone to look at something" half of the original complaint
  with a curated set rather than a single link.
- Reusing the ADR-0023 read-auth header avoids adding a fourth self-auth mechanism to a codebase that
  has already converged three.
- Private-by-default with no public counts keeps the feature free of ranking-game incentives.

**Negative / trade-offs:**

- Bookmarking requires a connected wallet. An anonymous browser cannot save anything, which is a real
  loss on the public surfaces where a lot of browsing happens.
- A new table, a new authenticated write path, and a migration.
- The server now holds a record of what each address finds interesting. It is not sensitive on its
  face, but it is personal interest data that did not previously exist anywhere.
- Publishing a collection means the URL is readable by whoever receives it. Whether that should be
  access-controlled instead is an open question in the RFC.

**Neutral / follow-up:**

- Saved searches — bookmarking a filter set rather than a thing — are a plausible follow-on and are
  deliberately out of scope. ADR-0096 already makes a filter set a URL, so the gap is smaller than it
  looks.
- Whether an anonymous local list should exist as a pre-connection convenience, and how it would merge
  on connect, is left open rather than decided here.

## References

- RFC: `docs/rfc/0010-shareable-ui-state-and-deep-linking.md`
- Spec: `docs/specs/bookmarks.md`
- Read-auth header reused: ADR-0023, and the narrower mechanisms it converged: ADR-0015, ADR-0017
- Visibility rules a published collection must respect: ADR-0014, ADR-0016, ADR-0030
- Deep links a bookmark stores: ADR-0096

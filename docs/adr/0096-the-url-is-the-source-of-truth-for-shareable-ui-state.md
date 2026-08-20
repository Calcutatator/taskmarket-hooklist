# 0096 — The URL is the single source of truth for shareable UI state

> **Decision (Y-statement):** In the context of a web app whose screens cannot be linked to or
> returned to, facing UI state that is split between the URL and component state with no rule
> saying which belongs where, we decided to classify every piece of state as shareable, session or
> ephemeral and to make the URL the sole store for the shareable tier with no component-state
> mirror, to achieve screens that can be cited, bookmarked and restored exactly, accepting that
> every interactive surface must be migrated and that shareable state now re-renders through
> routing rather than through local state.

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

`apps/web` has no rule about where UI state lives, and the result is a surface that cannot be
pointed at. `/tasks` carries eleven filter params in the URL through `parseTaskFilters` and
`taskFiltersHref`. `/dashboard` carries `?section=`. Task detail carries `?artifact=`. Every other
interactive surface — `/live`, the inbox, the worker submission history, the agent directory's
sorting, the distribution charts, the submission gallery's own navigation — holds its state in
`useState`, across 75 files.

The inconsistency is the visible problem, but it is not the interesting one. The interesting problem
is that where the URL *is* read, it is generally read once and discarded. `SubmissionGalleryDialog`
takes `initialArtifactId` from `?artifact=`, seeds `useState` with it, and never writes back. From
the first arrow press onward the address bar describes a screen the viewer is no longer looking at.
A person who receives a shared artifact link, browses two artifacts sideways, and copies the URL to
pass along sends their correspondent somewhere else. Adding more params does not fix this; only
deleting the `useState` mirror does.

There is also a question the phrase "make everything deep linkable" does not answer on its own: what
counts as everything. Putting literally all state in the URL is not a stricter version of the same
idea, it is a different and worse one. A video scrub position written to history makes Back
unusable. An unpublished task description written to the URL puts draft work into browser history,
referrer headers, server access logs, and any screen-share — for state whose sharing has no meaning
in the first place. A rule that does not say what is excluded cannot be applied, and a rule that
cannot be applied is not enforced at review.

The two constraints that shape the answer: the app is Next.js App Router with public reads defaulting
to Server Components reading `searchParams` directly, so URL state is already the natural input to
server rendering; and query params are untrusted input, which `parseStatus` already handles by
validating against the real enum and falling back rather than forwarding a hostile value to the API.

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| Classify state into shareable / session / ephemeral; URL is the sole store for the shareable tier, with no component-state mirror | An applicable rule with a stated boundary; every screen has an address; Server Components read it for free; the round-trip failure is ruled out by construction | Every interactive surface needs migrating; shareable-state changes now go through routing, so re-render cost and history behavior must be handled deliberately |
| Put all UI state in the URL (rejected) | No classification argument to have; trivially satisfies "everything is linked" | Thrashes history on continuous state; leaks draft form text into history, referrers and logs; produces unreadable URLs; makes Back useless |
| Keep the URL as an entry point that seeds component state (rejected) | Matches what `?artifact=` does today; no re-render changes; smallest diff | This is the current bug, not a fix: the URL goes stale the moment the user interacts, so a copied link is wrong exactly when someone bothers to share it |
| Persist UI state per user server-side and restore on load (rejected) | Survives across devices; keeps URLs short | Restores *your* view, never conveys it to someone else, which is the entire request; needs auth for anonymous public browsing; a shared link would show each viewer something different |
| Encode all shareable state into one opaque param, e.g. `?s=eyJ...` (rejected) | Short, uniform, no per-param naming | Unreadable and un-editable by hand; opaque to Server Components without a decode step; defeats crawler and cache comprehension; a truncated blob fails completely rather than partially |

## Decision

Every piece of UI state in `apps/web` is classified as exactly one of **shareable**, **session** or
**ephemeral**. Shareable state — anything a second person opening the link needs in order to see the
same screen — lives in the URL query string and nowhere else: no `useState` mirror, no seeding, no
"initial" prop that then drifts. Session state lives in `sessionStorage` or `localStorage`. Ephemeral
state lives in React state.

Shareable-tier state that is not URL-backed is a blocking review finding under
`docs/FRONTEND_GUIDE.md`, on the same footing as a hardcoded color utility.

Every write to shareable state declares its history intent. Refining an existing view replaces the
current entry; a transition a person would expect Back to undo pushes a new one.

## Consequences

**Positive:**

- Every screen has an address, which is the whole of the originating request: a person can send
  someone to what they are looking at, and get back to what they saw.
- The round-trip staleness bug is ruled out structurally rather than fixed case by case — there is no
  second copy of the state to fall out of sync.
- Server Components get the state for free, since it is already in `searchParams`; more surfaces can
  render on the server rather than being pulled behind a client boundary to hold their own state.
- Deep links become crawlable and cacheable, so a filtered or focused view can carry real metadata.
- Reload, Back, Forward and browser session restore all work without per-surface effort.

**Negative / trade-offs:**

- Roughly 36 routes and the components beneath them need auditing and, where they hold shareable
  state, migrating. This is a sustained effort, not a single change.
- Shareable-state updates now go through the router, so a surface that updates on every keystroke
  needs deliberate debouncing and `replace` semantics rather than getting local-state behavior by
  default.
- History intent becomes something every interactive control has to get right; wrong in either
  direction produces a Back button that is either useless or surprising.
- URLs get longer and, on a heavily filtered view, long enough that some clients truncate them.

**Neutral / follow-up:**

- The encoding, naming and collision rules for the params themselves are a separate decision
  (ADR-0097); this ADR decides only where shareable state lives.
- `parseTaskFilters` and `taskFiltersHref` are the existing implementation of most of this contract
  on one surface. They become the reference for the shared helper rather than being replaced.
- The migration order across surfaces is deliberately left to the spec, since it is reversible and
  local; the classification rule is what is hard to reverse.

## References

- RFC: `docs/rfc/0010-shareable-ui-state-and-deep-linking.md`
- Spec: `docs/specs/shareable-ui-state.md`
- Param encoding and namespace: ADR-0097
- Existing partial implementation: `apps/web/lib/market/task-filters.ts`,
  `apps/web/components/market/dashboard-section.ts`
- Round-trip failure this rules out: `apps/web/components/market/submission-gallery.tsx`

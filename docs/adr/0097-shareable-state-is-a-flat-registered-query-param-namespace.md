# 0097 — Shareable state is a flat, registered query-param namespace

> **Decision (Y-statement):** In the context of shareable UI state moving into the URL across every
> surface of the web app, facing param-name collisions between independently built features and no
> rule for what a canonical URL looks like, we decided to express shareable state as flat camelCase
> query params drawn from one repo-wide registry, omitting defaults, falling back on invalid values
> and preserving unowned params, to achieve one canonical address per screen that survives hostile
> input, accepting a registry that must be updated before a new param may ship.

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

ADR-0096 puts shareable UI state in the URL across the whole app. That immediately raises questions
it deliberately did not answer, and which will otherwise be answered differently on each surface by
whoever gets there first.

The collision problem is concrete rather than theoretical. `view` already means the table/gallery
toggle on `/tasks`, and `worker-submission-history.tsx` and `live-activity.tsx` each hold their own
independent `view` state today. `sort` is likewise about to exist on tasks, agents, submissions and
history, with different legal values on each. Once these move into the URL, two features that both
want `?view=` on the same route silently overwrite each other, and the bug surfaces as "the gallery
toggle stopped working when we shipped the history panel" — a long way from its cause.

There is also no current rule for what a canonical URL is. `taskFiltersHref` already omits any param
equal to its default, which is why `/tasks` and `/tasks?status=ALL&sort=newest` do not both exist as
distinct cacheable addresses. Nothing states that as a rule, so nothing stops the next surface from
writing every param unconditionally.

Query params are untrusted. `parseStatus` already validates `?status=` against the real `TaskStatus`
enum and falls back to `ALL`, with a comment noting that a stale bookmark, crafted URL or crawler can
put anything there — and that forwarding it through to the API produces a ZodError rather than a
page. That behavior is correct and currently local to one parser.

The existing params are camelCase — `taskDropId`, `minReward`, `deadlineHours`, `cursorStack`,
`requesterActorType` — matching the tRPC input schemas they feed. Any other convention means
translating at the boundary on every surface.

Finally, URLs carry params the app does not own: campaign tags, referral markers, params belonging to
a feature that has not shipped yet. A filter change that rebuilds the query string from a known list
destroys them, which breaks attribution in a way nobody notices until a report is wrong.

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| Flat camelCase params from one registry, defaults omitted, invalid values falling back, unowned params preserved | Human-readable and hand-editable; matches existing params and tRPC inputs; collisions caught at build rather than in production; one canonical address per screen | A registry is a coordination point that must be updated before a param ships; long filter sets produce long URLs |
| Per-surface prefixes, e.g. `?gallery.view=&history.view=` (rejected) | Collisions impossible by construction; no registry needed | Ugly and verbose in the common case where nothing collides; needs encoding rules for the separator; diverges from the params already shipped |
| One opaque encoded blob, e.g. `?s=eyJ2aWV3Ijoi...` (rejected) | Uniformly short; no naming or collision questions at all | Unreadable and un-editable; opaque to Server Components without a decode step; a truncated blob fails completely rather than degrading; defeats crawler and cache comprehension |
| Nested bracket syntax, e.g. `?filters[status]=open` (rejected) | Expresses grouping directly | Needs a parser the platform does not provide; encoding of brackets varies across chat clients and link unfurlers; no benefit over flat names at this depth |
| No registry, rely on review to catch collisions (rejected) | Zero process overhead | The failure is silent and appears far from its cause; review reliably catches this only while the surface count is small, which is exactly when it does not matter |

## Decision

Shareable UI state is expressed as flat, camelCase query params. Every param is declared in one
repo-wide registry module that records its name, the routes that own it, its legal values and its
default; a param not in the registry may not be written.

Four rules govern the URL itself:

1. **Defaults are omitted.** A param whose value equals its default is never written, so each screen
   has exactly one canonical address.
2. **Invalid values fall back to the default.** A param is never forwarded to the API unvalidated, and
   an unparseable value never produces an error page.
3. **Unowned params are preserved.** Rewriting the query string carries through every param the
   surface does not own.
4. **Absent means default.** No surface distinguishes an absent param from one explicitly set to its
   default value.

## Consequences

**Positive:**

- A person can read a Taskmarket URL and understand what it shows, and can edit one by hand — which
  is how a lot of real sharing and debugging actually happens.
- Collisions become a registry conflict at build time instead of a state-clobbering bug in production.
- One canonical address per screen makes shared links comparable, caches effective, and crawled pages
  non-duplicative.
- Hostile and stale URLs degrade to a sensible default view rather than to an error, generalizing what
  `parseStatus` already does.
- Campaign and referral params survive interaction, so attribution stays intact.

**Negative / trade-offs:**

- The registry is a coordination point: two branches adding params touch the same file and will
  conflict. That is the intended cost, but it is a real one.
- A heavily filtered view with a deep cursor stack produces a long URL, and some chat clients will
  truncate it. The RFC leaves whether to impose a length ceiling as an open question.
- Flat naming means a genuinely repeated control on one route needs a distinguishing name chosen by
  hand, e.g. `view` and `historyView`, rather than getting one from a prefix scheme.

**Neutral / follow-up:**

- `taskFiltersHref` and `parseTaskFilters` already implement rules 1, 2 and 4 for one surface; they
  become the reference implementation rather than being rewritten.
- Rule 3 is the one rule nothing in the codebase does today, so it needs its own coverage rather than
  being assumed from the existing tests.

## References

- RFC: `docs/rfc/0010-shareable-ui-state-and-deep-linking.md`
- Spec: `docs/specs/shareable-ui-state.md`
- Where shareable state lives: ADR-0096
- Existing partial implementation: `apps/web/lib/market/task-filters.ts`

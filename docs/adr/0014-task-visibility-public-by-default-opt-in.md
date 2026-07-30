# 0014 — Task visibility stays public by default; unlisted and private are strictly opt-in

> **Decision (Y-statement):** In the context of adding task-visibility controls
> (unlisted now, true private later) to Taskmarket, facing the question of what the
> default visibility should be for existing and new tasks, we decided to keep
> `'public'` as the permanent default with `'unlisted'` and (later) `'private'` as
> strictly opt-in, per-task choices, to achieve zero behavior change for the existing
> marketplace and its users, accepting that a privacy-conscious requester gets no
> protection unless they actively opt in.

- **Status:** Accepted
- **Date:** 2026-07-20
- **Embodiment:** Implemented
- **Last audited:** 2026-07-28
- **Author:** Beau
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —

## Context

PR #110 (`docs/rfc/0005-task-visibility-and-submission-visibility.md`) scopes work to let a requester make a task
not-publicly-listed. An early draft of that RFC was titled and framed around
"private-by-default" — i.e., new tasks would default to hidden, with `public` as an
opt-out. That framing directly contradicted the RFC's own concrete schema
recommendation (`visibility` defaulting to `'public'`), and was corrected during
review. This ADR records the resolved decision explicitly, since it is exactly the kind
of hard-to-reverse, product-shaping choice that belongs in one place rather than left
implicit in a schema default buried in an implementation PR.

Taskmarket's product value depends on open discovery today: public bounties,
SEO-indexed task pages, an og-worker that previews tasks for bots and social platforms,
and an `agents.inbox`/`agents.leaderboard` pattern that already treats wallet-level
history and reputation as public by design. Any visibility feature has to decide
whether it changes that baseline for every existing and future task, or only for tasks
that explicitly ask for something different.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Public by default; `unlisted`/`private` strictly opt-in (chosen) | Zero behavior change for the existing marketplace; matches today's status quo exactly; no backfill risk since existing rows already match the default; preserves the open-discovery value the product depends on | A requester who wants privacy but doesn't know the toggle exists gets none automatically |
| Private/unlisted by default, `public` as opt-out (rejected) | Arguably a better default for privacy-sensitive users | Inverts the core "open marketplace" value proposition (public bounties, SEO indexing, open discovery) that the product currently depends on; requires either backfilling every existing task to `'public'` or accepting that all historical tasks silently vanish from listings on deploy; surprises any existing integration that expects a newly created task to be discoverable the way every task has been until now |

## Decision

`tasks.taskVisibility` defaults to `'public'` for both new and existing rows. This is the
settled product decision, not a placeholder or an implementation detail: making a task
`'unlisted'` (Phase 1) or `'private'` (Phase 3, once it exists) is always an explicit,
per-task action taken by the requester, never inferred, never defaulted, and never
silently changed by a future migration.

## Consequences

**Positive:**
- No migration backfill risk — existing rows already match the new default, so no task
  is retroactively hidden by deploying this feature.
- Zero surprise for existing CLI/API integrations that create tasks without knowing
  about the new field.
- Preserves the open-discovery value proposition (public bounties, SEO indexing, open
  reputation lookups) that the marketplace's current product depends on.

**Negative / trade-offs:**
- Privacy is never the default; a requester who wants it must know to ask for it. This
  places real weight on the product/UX work (the visibility toggle and its plain-
  language disclaimer) actually being discoverable at task-creation time.

**Neutral / follow-up:**
- This decision is specifically about the *default*. Whether `unlisted` and `private`
  should exist as opt-in choices at all, and how each is implemented, is the separate
  subject of PR #110 and (for the narrower Phase 1 auth question) ADR 0015.

## References

- PR #110 — `docs/rfc/0005-task-visibility-and-submission-visibility.md` (the RFC this decision was extracted from)
- Issue #183 — Phase 1 implementation tracker

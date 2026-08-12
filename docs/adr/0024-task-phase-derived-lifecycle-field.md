# 0024 — Add a derived `phase` field for the deadline-passed/awaiting-closeout task state

> **Decision (Y-statement):** In the context of a task's `status` legitimately staying
> `open`/`claimed`/`worker_selected` past its `expiryTime` (since status only transitions
> via an explicit `refundExpired` transaction or an indexer-observed event, never
> automatically on a timer — ADR-0007), facing the problem that a client filtering or
> displaying by `status` alone has no first-class way to know it must separately
> cross-check `expiryTime` and `submissionWindowOpen` to detect this, we decided to add
> an additive, server-computed enum field named `phase`
> (`active` / `in_review` / `awaiting_settlement` / `resolved`) alongside `status` and
> `submissionWindowOpen`, to achieve a named, filterable concept for this state without
> redefining `status` itself, accepting a larger schema/CLI surface than a narrower
> `expired: boolean` would have needed.

- **Status:** Accepted
- **Date:** 2026-07-23
- **Accepted:** 2026-07-23
- **Embodiment:** Verified
- **Last audited:** 2026-07-29
- **Author:** Beau
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —

## Context

Issue #196 (UX Review 1, items 7-9) surfaced this from two angles:

- `task list --status open` (and `GET /api/tasks?status=open`) already excludes tasks
  whose deadline has passed (#166); `--status claimed`/`--status worker_selected` — the
  equivalent submission-window states for claim/auction and pitch mode — did not. That
  gap is fixed separately from this ADR (`tasks.router.ts`'s `list` query now applies the
  same `expiryTime` guard to all three statuses; see PR #234) since it was a narrow,
  uncontroversial bug-fix bringing an existing precedent into line, not a new API
  surface.
- Fetching a single task by ID is intentionally unfiltered by expiry — the requester
  still needs to see and act on it (accept/reject/refund) — so `status: "open"` and
  `submissionWindowOpen: false` can appear together on one task. This is correct, not a
  bug, but nothing named the condition, so a caller has no way to detect it except
  re-deriving the backend's own logic.

`docs/rfc/0004-task-phase-field.md` scoped three options (a narrow `expired: boolean`;
an additive derived enum; doing nothing beyond documentation) and recommended the enum,
gated on this ADR settling the exact values and the treatment of the evaluator/dispute
statuses. This ADR is that follow-up decision, keeping the RFC's original working name,
`phase`.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Additive `phase` enum, 4 values (`active`/`in_review`/`awaiting_settlement`/`resolved`) (chosen) | Names the exact condition items 7-9 describe; filterable via CLI/API so a client does not have to reconstruct it from three fields; `in_review` gives the evaluator/dispute flow its own bucket instead of overloading `active`, matching that it is a pending human/evaluator decision, not routine progress; forward-compatible if another derived distinction is ever needed | Larger surface than a boolean: needs its own schema field, filter param, docs, and tests; a 4th enum value to maintain going forward |
| Additive `phase` enum, 3 values (`active`/`awaiting_settlement`/`resolved`), folding review/appealing/disputed into `active` (rejected — the RFC's original draft) | Smaller enum, less to maintain | Conflates "routine work in progress" with "a human/evaluator decision is pending" — a caller filtering for genuinely actionable-by-anyone work would still need to separately check `status` to exclude the judged states, defeating some of the point of adding the field |
| Narrow `expired: boolean` (rejected) | Smallest possible surface | Cannot express `in_review` at all; if a future need arises to distinguish further sub-states, this forces either overloading the boolean's meaning or bolting on a second field later — the exact "narrow flag now, reshape later" pattern this decision exists to avoid |
| Do nothing; only document the reconstruction in `task-schema.md` (rejected) | Zero schema risk | Leaves the CLI/API filter gap from item 9 unmet; every client must reimplement the same three-field reconstruction |
| Redefine `status` itself to fold in the deadline check (rejected) | Would not need a new field at all | Breaks the invariant ADR-0006/ADR-0007 anchor correctness around — `status` must remain a literal mirror of on-chain/indexer state; redefining it would silently change meaning for every existing integration already branching on today's `status` values |

## Decision

Add `tasks.phase`, a server-computed (not stored) derived field, to `TaskDetailResponseSchema`
and `TaskResponseSchema` (`packages/shared`), and as a filterable, optional
`TaskListInputSchema` param applied the same way `status` is today:

- `in_review` — `status` is `review`, `appealing`, or `disputed`. A human/evaluator
  decision is pending; this is not routine in-progress work and not a deadline-driven
  wait, so it gets its own bucket rather than folding into `active`.
- `awaiting_settlement` — `status` is `open`, `claimed`, or `worker_selected` **and**
  `expiryTime` has passed. This is exactly the condition items 7-9 describe: the
  submission window has closed but nobody has taken the closeout action yet.
- `active` — `status` is `open`, `claimed`, or `worker_selected` **and** `expiryTime` has
  not passed, or `status` is `pending_approval` (no deadline gates this one; it is
  already `submissionWindowOpen: false` by definition once a designated worker has
  delivered, but is still routine in-progress work, not evaluator/dispute-pending).
- `resolved` — `status` is `completed`, `cancelled`, or `expired` (all three terminal).

Computed once, alongside `computeSubmissionWindowOpen`, in `apps/backend/src/lib/task.ts`,
and reused by both `tasks.get` and `tasks.list` so the two endpoints can never disagree
on the same task.

## Consequences

**Positive:**
- Gives items 7-9's interim state a first-class, named, filterable value instead of
  requiring every client to reconstruct it from `expiryTime` + `status` +
  `submissionWindowOpen`.
- `status` itself is untouched — every existing integration keeps working exactly as
  today; `phase` is purely additive.
- `in_review` separates "a human/evaluator decision is pending" from "routine work in
  progress," which a plain 3-value enum could not express.

**Negative / trade-offs:**
- A 4-value enum is more surface than the narrower `expired: boolean` alternative — more
  schema, docs, filter-handling, and test coverage to maintain going forward.
- Two ways to ask a similar question now exist (`status` for the literal on-chain state,
  `phase` for the derived bucket); a new contributor has to learn both are intentional,
  not redundant.

**Neutral / follow-up:**
- Whether `apps/web/lib/market/status-config.ts`'s client-side `StatusPhase`/
  `taskStatusPhase` (`workable`/`in-progress`/`closed`) should be replaced by trusting the
  server's `phase` directly is not decided here — that mapping is close but not identical
  (e.g. it has no `in_review`-equivalent bucket today) and is left as a separate
  follow-up rather than folded into this decision.
- Whether `phase` should appear on narrower per-mode responses (bids, pitches, proofs) is
  left to implementation judgment, not decided here — the task-level field is what items
  7-9 actually asked for.

## References

- Issue #196 (UX Review 1), items 7-9
- `docs/rfc/0004-task-phase-field.md` — the RFC this ADR decides
- ADR-0006 — task_awards as the single source of truth for settlement (the `status`
  correctness invariant this decision does not touch)
- ADR-0007 — indexer status transitions are guarded by prior state (why `status` can sit
  past `expiryTime` without transitioning)
- `apps/backend/src/lib/task.ts` (`computeSubmissionWindowOpen`, the sibling computation
  `phase` is added next to)

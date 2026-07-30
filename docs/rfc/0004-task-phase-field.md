# 0004 — A `phase` Field for "Deadline Passed, Still Awaiting Requester Closeout"

- **Status:** Accepted — see [ADR-0024](../adr/0024-task-phase-derived-lifecycle-field.md). The
  field ships as `phase`, matching this RFC's original working name, but with a 4-value enum
  (adding `in_review` for the evaluator/dispute statuses) rather than the 3-value draft below. This
  document is left as the historical record of the options considered; ADR-0024 is the actual
  decision.
- **Date:** 2026-07-23
- **Author:** Beau
- **Supersedes / Superseded-by:** —

## Summary

A task's on-chain deadline (`expiryTime`) can pass while `status` is still
`open`/`claimed`/`worker_selected`, because `status` only transitions via an explicit
`refundExpired` transaction or an indexer-observed event — never automatically on a timer (see
[ADR-0007](../adr/0007-indexer-status-transitions-are-guarded-by-prior-state.md)). Today, a client
that wants to know "is this task actually still accepting work, or is it just waiting for someone
to close it out" has to reconstruct that from three separate fields (`expiryTime`, `status`,
`submissionWindowOpen`) and mode-specific rules it must already know. This RFC asks whether the API
should expose this as a first-class, named, filterable concept instead.

## Motivation

This gap surfaced from two angles in issue #196 (UX Review 1):

- **Item 7** (CLI): `task list --status open` already excludes tasks whose deadline has passed
  (added for #166); `--status claimed` and `--status worker_selected` — the equivalent
  submission-window states for claim/auction and pitch mode — did not. **This half is fixed
  separately from this RFC** (see the `tasks.router.ts` `list` query, which now applies the same
  `expiryTime` guard to all three statuses) — it was a narrow, uncontroversial bug-fix bringing an
  existing precedent into line, not a new public API surface, so it did not need to wait on this
  document.
- **Item 8** (CLI/API): fetching a single task by ID (`GET /api/tasks/{taskId}`) is *intentionally*
  unfiltered by expiry — the requester still needs to see and act on it — so `status: "open"` and
  `submissionWindowOpen: false` can legitimately appear together on one task. This is correct, not a
  bug, but nothing named the condition, so a caller has no way to detect it except re-deriving the
  same logic the backend already has.

Item 9 in that issue proposed a concrete direction, reproduced here for discussion:

> Keep `status` as a literal mirror of on-chain state, since redefining it would silently break
> existing integrations (ADR-0006/0007 already anchor correctness around `status` matching what the
> indexer observed on-chain). Add a new, additive derived **enum** field alongside `status` and
> `submissionWindowOpen` — tentatively `phase` (e.g. `active` / `awaiting_settlement` / `resolved`)
> rather than a narrow `expired: boolean`, so it can absorb future derived distinctions without
> another schema reshape — and expose it as a filterable CLI/API param.

## Proposal

### Option A — `expired: boolean`

The narrowest possible addition: `true` once `expiryTime` has passed and the task is still in a
submission-window status (`open`/`claimed`/`worker_selected`).

- **Pro:** smallest surface, trivial to compute and document.
- **Con:** a boolean can't grow. If a future need arises to distinguish, say, "past deadline,
  nobody has submitted anything" from "past deadline, submissions exist and await review" from
  "resolved" states, a boolean forces either overloading its meaning or bolting on a second field
  later — exactly the "narrow flag now, reshape later" pattern issue #196 asked to avoid.

### Option B — `phase` enum: `active` / `awaiting_settlement` / `resolved`

A three-value derived enum computed server-side and exposed on both `tasks.list` and `tasks.get`
responses (and any equivalent inbox/dashboard aggregate that already surfaces `status`).

Proposed mapping (open for revision — see Open questions):

| `phase` | Statuses | Condition |
| --- | --- | --- |
| `awaiting_settlement` | `open`, `claimed`, `worker_selected` | `expiryTime` has passed |
| `active` | `open`, `claimed`, `worker_selected` | `expiryTime` has not passed |
| `active` | `pending_approval`, `review`, `appealing`, `disputed` | always (no deadline gates these) |
| `resolved` | `completed`, `cancelled`, `expired` | always (terminal) |

- **Pro:** matches the shape of the frontend's own `taskStatusPhase`/`StatusPhase` concept
  (`workable` / `in-progress` / `closed` in `apps/web/lib/market/status-config.ts`), which already
  solves the identical "group raw statuses into a coarser lifecycle bucket" problem for the UI. An
  API-level `phase` could plausibly *replace* the frontend's client-side derivation entirely,
  removing a duplicated mapping — worth confirming as part of the ADR if this direction is chosen.
- **Pro:** additive and forward-compatible — a genuinely new derived distinction becomes a new enum
  value, not a second boolean flag next to the first.
- **Con:** larger surface than a boolean; needs its own tests, docs, and (per issue #196) a
  filterable CLI/API param, which is more implementation than Option A.

### Option C — do nothing; document the reconstruction

Leave the fields as they are and only add doc prose (already done — see `task-schema.md`'s
`submissionWindowOpen` section) telling a client how to reconstruct this from `expiryTime` +
`status` + `submissionWindowOpen`.

- **Pro:** zero schema risk, zero new surface.
- **Con:** every client has to reimplement the same derivation, and the CLI/API filter request from
  issue #196 (search/filter by this state directly) stays unmet.

### Recommendation (non-binding)

Option B, gated on an ADR that settles the exact enum values and mapping table above — in
particular the treatment of `review`/`appealing`/`disputed` (arguably these are their own thing, not
`active`, since a human/evaluator decision is pending rather than routine progress) and the naming
ambiguity of `resolved` for `cancelled` (cancelled with a full refund is not "resolved" in the sense
a requester would parse as a positive outcome, but it is out of the workflow-active set).

### Scope if accepted

- Add `phase` to `TaskDetailResponseSchema` and `TaskResponseSchema` (`packages/shared`), computed
  once (likely in `apps/backend/src/lib/task.ts`, next to `computeSubmissionWindowOpen`) and reused
  by both `tasks.get` and `tasks.list`.
- Add `phase` as an optional `TaskListInputSchema` filter, applied the same way `status` is today,
  so `task list --phase awaiting_settlement` works without a client needing to know which raw
  statuses feed into it.
- Update `apps/docs/src/public/reference/task-schema.md` (and its `pages/` mirror, per the docs
  workflow in `AGENTS.md`) to document the new field and retire the manual reconstruction prose this
  RFC's Option C would otherwise leave in place.
- Consider (separate follow-up, not blocking this RFC) whether
  `apps/web/lib/market/status-config.ts`'s client-side `StatusPhase`/`taskStatusPhase` can be
  replaced by trusting the server's `phase` directly, removing a duplicated mapping between backend
  and frontend.

## Open questions

1. Exact enum values and the `review`/`appealing`/`disputed` mapping (see Recommendation).
2. Should `phase` also appear on narrower per-mode responses (bids, pitches, proofs) or only on the
   task itself?
3. Backward compatibility: is an additive optional field enough, or does this warrant a CLI/API
   version note given issue #196 frames it as "changes public API/CLI semantics"? (Nothing existing
   changes meaning under Option B — only a new field is added — but the ADR should say so explicitly
   since the issue raised the concern.)

## Non-goals

- **Redefining `status`.** `status` stays a literal mirror of on-chain state. This RFC does not
  propose changing what `status` means or when it transitions — that is exactly the invariant
  ADR-0006 and ADR-0007 protect, and this RFC's whole premise is that redefining it would silently
  break existing integrations that already branch on today's `status` values.
- **Changing `submissionWindowOpen`.** It stays scoped to "can an artifact deliverable be submitted
  right now" (see `task-schema.md`'s `submissionWindowOpen` table). `phase` is a coarser, orthogonal
  signal — not a replacement.

## References

- Issue: daydreamsai/taskmarket#196 (UX Review 1), items 7-9.
- `docs/adr/0006-task-awards-single-source-of-truth.md`
- `docs/adr/0007-indexer-status-transitions-are-guarded-by-prior-state.md`
- `apps/docs/src/public/reference/task-schema.md` (`submissionWindowOpen` section)
- `apps/backend/src/lib/task.ts` (`computeSubmissionWindowOpen`)
- `apps/web/lib/market/status-config.ts` (`StatusPhase`, the frontend's existing analog)

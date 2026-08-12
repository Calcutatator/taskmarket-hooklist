# 0006 — `task_awards` is the sole post-completion source of truth; `claimedBy` is the sole pre-completion assignment field

> **Decision (Y-statement):** In the context of ADR-0004's `tasks.worker`/`tasks.rating`
> "permanent compatibility fields" creating two sources of truth for "who won this task,"
> facing repeated bugs from that duality (an `agents` JOIN fan-out, a reconciliation
> double-counting bug, and a settlement race in `resolveDispute`/`finalizeVerdict` where task
> status flips to `completed` before any `task_awards` row exists) and a rejection of the
> premise that single-winner and multi-winner tasks need different data shapes, we decided to
> drop `tasks.worker` and `tasks.rating` entirely and unify pre-completion assignment onto the
> existing `claimedBy` column across all task modes, to achieve exactly one source of truth for
> "who is/was working this task" regardless of how many winners it ends up having, accepting a
> first-ever `DROP COLUMN` migration in this repo and a large coordinated multi-file edit.

- **Status:** Accepted
- **Date:** 2026-07-16
- **Accepted:** 2026-07-18
- **Embodiment:** Implemented
- **Last audited:** 2026-07-29
- **Author:** Beau
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** Supersedes [0004](0004-task-awards-event-backed-ledger-table.md)

## Context

ADR-0004 introduced `task_awards` (one row per award recipient, replay-safe via a
`(chainId, blockNumber, logIndex)` unique index) but kept `tasks.worker`/`tasks.rating` as
permanent "primary-winner compatibility fields," explicitly not scheduled for removal. That
review already found two bugs directly caused by the duality: a `.leftJoin(agents, ...)`
building the awards-with-agent-metadata API response that fanned out to duplicate awards, and a
`primaryRatingMismatches` reconciliation query with the same fan-out shape double-counting its
diagnostic summary.

A further review of ADR-0004 itself, before it was ever accepted, rejected the underlying
premise: a single-winner task is not architecturally different from a multi-winner task, it is
simply a task whose set of winners has size one. Modeling it with a separate scalar "primary
winner" field alongside the general `task_awards` table reintroduces exactly the two-sources-
of-truth problem `task_awards` was built to solve, just for the common case instead of the rare
one.

Auditing every consumer of `tasks.worker`/`tasks.rating` surfaced that `worker` was doing
double duty: as the post-completion "who was paid" signal (redundant with `task_awards`), and
as the pre-completion "who is currently assigned" signal for pitch-selection and auction-
selection flows, which — unlike claim-mode and auction-accept flows — never wrote the existing,
separate `claimedBy` column. A third finding: `resolveDispute` and `finalizeVerdict`'s approve
path both flip `tasks.status` to `'completed'` synchronously within the mutation, but the
matching `task_awards` row is only inserted later, asynchronously, once the indexer processes
the resulting on-chain `TaskCompleted` event(s) — a real eventual-consistency window with no
data-loss safety net beyond ADR-0003's fail-fast boot reconciliation.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Drop `tasks.worker`/`tasks.rating`; unify pre-completion assignment on `claimedBy`; fix the settlement race (chosen) | Exactly one source of truth for "who won" (`task_awards`) and exactly one for "who's assigned" (`claimedBy`), for any winner-set size; eliminates the entire bug class ADR-0004 already found two instances of; forces the `resolveDispute`/`finalizeVerdict` race to be fixed rather than papered over | First-ever `DROP COLUMN` migration in this repo; a large, coordinated multi-file edit across backend routers, the indexer, the shared API schema (breaking change), and the web app; requires a data backfill (`claimedBy = worker` for any in-flight task that only ever had `worker` written) before the columns can safely be dropped |
| Keep ADR-0004 as originally proposed — retain `tasks.worker`/`tasks.rating` permanently (rejected) | No migration, no breaking API change, smallest diff | Keeps two sources of truth for "who won" permanently, with no compiler-enforced signal to remind a future author which one to use; the fan-out and reconciliation bugs already found are evidence this duality produces real, recurring defects, not a hypothetical risk |
| Middle ground — drop `tasks.rating` only (low risk, `task_awards.rating` was already the reconciliation source of truth) but keep `tasks.worker` as a compatibility field (rejected) | Smaller, lower-risk change; addresses the rating half of the duality with no assignment-tracking redesign needed | Leaves the `worker` half of the duality — including the actual settlement race bug — unfixed; produces an asymmetric model that's harder to explain than either "keep both" or "drop both" |

## Decision

`tasks.worker` and `tasks.rating` are removed via migration `0028_drop_task_worker_rating.sql`,
shipped in a separate follow-up PR/deploy from the `task_awards` table creation (`0027`) per
ADR-0008 — the two cannot safely land in the same deploy. Post-completion, "who won and what
rating" is derived exclusively from `task_awards`, ordered
by `rank` (rank 1 is the primary/first winner — an in-query read-time projection, not a stored
field, so there is nothing for it to drift out of sync with). Pre-completion, "who is currently
assigned" is derived exclusively from the existing `claimedBy` column, now written by every
assignment path (claim, pitch-selection, auction-selection, contest-mode evaluate) instead of
only some of them. `resolveDispute` and `finalizeVerdict`'s approve path now call the same
`recordTaskSettlement` helper the indexer uses, synchronously, using data parsed out of the
transaction receipt they already wait for — closing the eventual-consistency window instead of
relying solely on the async indexer.

List and inbox API responses gain a `primaryAward: {workerAddress, rating} | null` field
(alongside the existing `awardCount`) computed via a correlated scalar subquery against
`idx_task_awards_task_rank` (`order by rank limit 1`) — the same query-cost class as the
`awardCount` subquery already in place, chosen over both "count only" (worse at-a-glance UX for
agents/users paging a task list) and "full `awards[]` on every response tier" (real
`json_agg`/`GROUP BY` aggregation cost, payload size scaling with winner-set size, mostly wasted
for the common case). Detail responses retain the full `awards[]` array.

## Consequences

**Positive:**
- Exactly one source of truth for "who won this task and what rating did they get"
  (`task_awards`), for any winner-set size from one to many, eliminating the bug class ADR-0004
  already found two live instances of.
- Exactly one source of truth for "who is currently assigned" (`claimedBy`) across every task
  mode, where previously `worker` and `claimedBy` disagreed on which flows wrote them.
- The `resolveDispute`/`finalizeVerdict` settlement race is closed: a `task_awards` row exists
  synchronously, before the mutation returns, instead of depending on the next indexer poll.

**Negative / trade-offs:**
- This is the first `DROP COLUMN` migration in this repo's history — no prior-art pattern to
  fall back on, and it is irreversible without a manual restore from a backup.
- `TaskResponseSchema` loses `worker`/`rating` — a breaking change for any external consumer of
  the public API (documented CLI/agent clients) that reads those fields directly.
- `isPrimary`/"primary winner" is now a `rank === 1` read-time approximation rather than a
  contract-sourced scalar. This is behaviorally identical in the overwhelming common case (the
  existing `isPrimary` computation already derives from `settlement.primaryWorker`, which is
  itself `awards[0]?.workerAddress` in most paths), but a hypothetical future divergence between
  on-chain "primary worker" designation and event-order rank would not be individually
  observable without opening the full award list.

**Neutral / follow-up:**
- The migration requires a one-time backfill (`claimed_by = worker` where `claimed_by` is still
  null) for any task that was assigned via a pre-fix pitch-selection/auction-selection write,
  plus a defensive assertion that every `status='completed'` task already has a `task_awards`
  row — belt-and-suspenders on top of ADR-0003's existing fail-fast boot guarantee.
- If a future need arises for a contract-sourced (not rank-derived) primary-award designation,
  that would need its own ADR — it was deliberately not built here, since nothing in the current
  codebase demonstrates rank and on-chain designation actually diverge in practice.

## References

- PR #166 (`ponderingdemocritus/trace-split-task-ui`).
- ADR-0004 (superseded by this ADR), ADR-0003 (the fail-fast boot invariant this migration's
  safety assertion also checks), ADR-0008 (the migration's `0027`/`0028` deploy split).
- `apps/backend/drizzle/migrations/0028_drop_task_worker_rating.sql`,
  `apps/backend/src/db/schema.ts`.
- `apps/backend/src/services/settlement-recorder.ts`, `settlement-projector.ts`, `contract.ts`
  (`contractResolveDispute`/`contractFinalizeVerdict` fix).
- `apps/backend/src/lib/task.ts` (`computePendingActions` unification).
- `packages/shared/src/schemas/task.schemas.ts` (`TaskResponseSchema` breaking change,
  `primaryAward` addition).

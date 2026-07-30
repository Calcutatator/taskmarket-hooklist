# 0004 — Split-payout settlement is a separate event-backed `task_awards` ledger table

> **Decision (Y-statement):** In the context of fixing the indexer overwriting `tasks.worker`
> on every `TaskCompleted` event (losing all but the last winner on a split/ranked-payout
> task), facing the question of how to persist multiple award recipients per task, we decided
> to add a separate `task_awards` table — one row per award, keyed for replay-safe idempotency
> by `(chainId, blockNumber, logIndex)` — and retain `tasks.worker`/`tasks.rating` as permanent
> "primary-winner compatibility fields" rather than removing them, to achieve relational
> idempotency guarantees and zero breakage for existing single-winner consumers, accepting that
> "who won this task" now has two sources of truth that every new query must consciously choose
> between.

- **Status:** Superseded
- **Date:** 2026-07-16
- **Embodiment:** Implemented
- **Last audited:** 2026-07-28
- **Author:** Loaf
- **Reviewers:** Loaf — self-attested; no independent reviewer recorded
- **Deciders:** Loaf — self-attested; no independent decider recorded (this ADR
  retroactively documents a decision already implemented in PR #166's original commits, before
  this repo's ADR process was applied to it; the compatibility-field retention described below
  was reviewed and rejected before ever reaching `Accepted` — see ADR-0006)
- **Supersedes / Superseded-by:** Superseded by [0006](0006-task-awards-single-source-of-truth.md)

## Context

Before PR #166, a `TaskCompleted` event handler unconditionally set `tasks.worker` on every
completion. For a bounty/benchmark task with multiple winners (`acceptSubmissions` emits one
`TaskCompleted` event per `(worker, share)` pair), each event overwrote the previous one — the
DB ended up recording only the last winner, silently losing every earlier award. Fixing this
required deciding how to represent "N winners, each with a rank, share, gross/net/fee amount,
settlement tx, and independent rating" persistently, in a way that's safe to replay (the
indexer can reprocess the same on-chain event on retry) and doesn't break every existing
endpoint/UI surface that assumes `task.worker` is a single address.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Separate `task_awards` table, one row per award (chosen) | Composite unique index `(chainId, blockNumber, logIndex)` gives cheap, correct replay-safe idempotency via `onConflictDoNothing` + `.returning()`; each award gets real typed columns (rank, isPrimary, grossAmount, workerPayment, platformFee, settlementTxHash, rating); "worker's award history" and "task's award list" are simple indexed joins/selects | Two sources of truth (`tasks.worker`/`tasks.rating` vs `task_awards`) that must be kept in sync by every write path; this review found two real bugs stemming directly from that duality (an `agents` JOIN fanout building the awards-with-agent-metadata response, and duplicate rows in the primary-rating reconciliation query) |
| `tasks.worker`/`tasks.rating` become arrays (e.g. `worker_addresses text[]`, `ratings smallint[]`) (rejected) | No new table; smaller migration | Can't cheaply enforce per-chain-event idempotency on an array column (no equivalent of a composite unique index + `onConflictDoNothing` per array element); awkward to store per-award metadata (rank, amounts, tx hash) without several parallel arrays that must stay index-aligned; breaks every existing consumer's assumption that `tasks.worker` is a scalar, the exact blast radius the compatibility-field approach was meant to avoid |
| Awards stored as a `jsonb` blob on the `tasks` row (rejected) | Flexible schema; no new table for future award fields | No DB-level unique index for per-event idempotency — replay-safety was the core bug this PR fixes, and a JSONB blob can't give the same guarantee as a real composite unique constraint; "find all tasks a worker won" becomes a JSONB containment query instead of an indexed join; no typed/referential integrity on award fields |

## Decision

Split-payout settlement is recorded in a dedicated `task_awards` table (migration `0027`), one
row per award, with a `(chainId, blockNumber, logIndex)` composite unique index backing replay
safety. `tasks.worker` and `tasks.rating` are retained permanently as "primary-winner
compatibility fields" — not a temporary migration shim — for consumers that only need the
single-winner view.

## Consequences

**Positive:**
- Replay-safe idempotency comes from a real DB constraint (`onConflictDoNothing` +
  `.returning()` inside one transaction), not application-level bookkeeping.
- Existing single-winner consumers (anything reading `task.worker`/`task.rating`) keep working
  unmodified.
- Per-award data (rank, primary flag, gross/net/fee amounts, settlement tx, independent rating)
  has proper typed, queryable columns.

**Negative / trade-offs:**
- "Who won this task" has two sources of truth that must be kept consistent by every write
  path and consciously chosen between by every read path. This review found and fixed two bugs
  directly caused by that duality: a `.leftJoin(agents, lower(address)=lower(worker_address))`
  building the awards-with-agent-metadata API response that fanned out to duplicate awards when
  `agents` held more than one row for the same address, and a `primaryRatingMismatches` query in
  the reconciliation backfill with the same fan-out shape, double-counting its diagnostic
  summary.
- Any future endpoint or query that touches "the winner(s)" of a task must explicitly decide
  whether it needs the compatibility field or the full `task_awards` list — there is no
  compiler-enforced signal to remind an author of this, only convention and code review.

**Neutral / follow-up:**
- The compatibility fields are a permanent part of the model, not scheduled for removal; a
  future decision to deprecate them would need its own ADR superseding this one.
- `docs/DB_GUIDE.md` and `docs/public/reference/split-acceptance.md` already document the
  compatibility-field convention for consumers; this ADR records the schema-level reasoning
  behind it.

## References

- PR #166 (`ponderingdemocritus/trace-split-task-ui`).
- `apps/backend/drizzle/migrations/0027_add_task_awards.sql`, `apps/backend/src/db/schema.ts`
  (`taskAwards` table).
- `apps/backend/src/services/settlement-recorder.ts`, `settlement-projector.ts`,
  `settlement-rating.ts`.
- `docs/DB_GUIDE.md`, `apps/docs/src/public/reference/split-acceptance.md`.

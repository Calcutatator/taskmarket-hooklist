# 0003 — Backend boot fails fast on indexer catch-up and task-award reconciliation

> **Decision (Y-statement):** In the context of PR #166's split-task settlement rework, facing
> the question of whether a failure in on-chain indexer catch-up or the new task-award
> ledger-reconciliation step should be allowed to block the API from starting, we decided to
> fail fast — `server.ts` awaits migration, indexer catch-up, and reconciliation in sequence
> before `app.listen()`, with no error handling — to achieve a hard guarantee that the API
> never serves traffic against an indexer or award ledger known to be behind or inconsistent,
> accepting that a transient RPC hiccup or any pre-existing data inconsistency can prevent the
> backend from starting at all, with no built-in override.

- **Status:** Accepted
- **Date:** 2026-07-16
- **Embodiment:** Verified
- **Last audited:** 2026-07-29
- **Author:** Beau
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —

## Context

Before PR #166, `server.ts` only awaited `migrate()` before calling `app.listen()`. Indexer
catch-up (`startIndexer()`) ran *inside* the `app.listen()` callback — after the server was
already accepting traffic — and its own internal catch-up call was wrapped in a try/catch that
logged and continued on failure. A slow or unreachable RPC provider at boot meant the API came
up immediately and the indexer caught up in the background (or kept retrying every poll
interval) without blocking availability.

PR #166 introduces `prepareBackendState()` (`startup-preparation.ts`), which runs
`migrate() → catchUpIndexer() → reconcileTaskAwards()` as a single awaited sequence in
`server.ts`, entirely before `app.listen()`, with no error handling anywhere in the chain — a
failure at any step calls `process.exit(1)` and the HTTP/tRPC API never starts. The third step,
`reconcileTaskAwards()` (backed by `runConfiguredTaskAwardsBackfill()`), is new: its
`validate()` phase throws if it finds any `completed` task with no matching on-chain settlement
event (`completedWithoutAwards`), with no time or block bound on the query and no
environment-variable override to make this non-fatal.

This was flagged during a deep re-review of PR #166 as an availability regression relative to
pre-PR behavior, worth an explicit decision rather than an implicit side effect of the
settlement-recording rework.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Fail fast (chosen) — keep `prepareBackendState()` blocking `app.listen()`, no error handling | The API can never serve reads/writes against an indexer or award ledger known to be behind or inconsistent; a broken deploy is loud and immediate (crash-loop, restart alerts) rather than silently degraded | A transient RPC error, or any single pre-existing `completed` task lacking a settlement event, blocks the entire API — not just indexing — until manually repaired; no partial-availability mode |
| Restore pre-PR resilience — only `migrate()` blocks boot; `catchUpIndexer()` and `reconcileTaskAwards()` run after `app.listen()`, each wrapped in try/catch that logs and continues | API availability matches pre-PR behavior; a bad RPC provider or one inconsistent task degrades indexing/reconciliation, not the whole service | The API can serve stale reads (indexer behind) or an inconsistent award ledger for an unbounded time with only a log line marking it, easy to miss in practice |
| Middle ground (rejected) — keep `migrate()` and `catchUpIndexer()` as hard gates, make only `reconcileTaskAwards()` non-fatal | Indexing stays fresh before serving (matches the existing awaited-catchUpIndexer precedent); removes only the newest and least-bounded failure mode | Splits the "fail fast" guarantee unevenly across the three steps for reasons a future reader would have to reconstruct from git history rather than read in one place |

## Decision

Fail-fast stays as PR #166 implemented it: `migrate()`, `catchUpIndexer()`, and
`reconcileTaskAwards()` all block `app.listen()`, and any failure in any of the three is fatal
to backend startup. No code change was made in response to the finding.

## Consequences

**Positive:**
- The API has a hard guarantee that it never serves traffic while the indexer is known to be
  behind or the task-award ledger is known to be inconsistent with on-chain settlement events.
- Failures are loud (process exit, restart/alerting) rather than a log line that can go
  unnoticed while the service continues serving degraded data.

**Negative / trade-offs:**
- A transient RPC provider hiccup during boot can prevent the API from starting at all, with no
  automatic backoff/retry before `process.exit(1)`.
- `reconcileTaskAwards()`'s `validate()` check has no time or block bound: any single
  pre-existing `completed` task with a missing settlement event blocks every future boot until
  a human repairs the offending row directly — there is currently no environment-variable
  escape hatch (e.g. a `SKIP_TASK_AWARDS_RECONCILE`-style override) for an operator to recover
  service quickly while investigating.

**Neutral / follow-up:**
- If crash-loop-on-transient-RPC-error becomes a real operational problem, the fix should be
  scoped narrowly (e.g. retry-with-backoff inside `catchUpIndexer`/`reconcileTaskAwards`
  specifically for RPC-class errors) rather than reopening this ADR's core fail-fast guarantee.
- An explicit manual override for `reconcileTaskAwards()`'s validation failure (beyond the
  existing `TASK_AWARDS_BACKFILL_IGNORE_CHECKPOINT` var, which replays from a block, not skips
  validation) would reduce the operational cost of the negative above without changing the
  decision itself.

## References

- PR #166 (`ponderingdemocritus/trace-split-task-ui`) — introduces `prepareBackendState()`,
  `startup-preparation.ts`, `configured-task-awards-backfill.ts`.
- `apps/backend/src/server.ts`, `apps/backend/src/services/startup-preparation.ts`.

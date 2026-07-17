# 0008 — `task_awards` table creation and the `tasks.worker`/`tasks.rating` drop ship in two separate deploys

> **Decision (Y-statement):** In the context of migrations `0027_add_task_awards` and
> `0028_drop_task_worker_rating` both being pending in the same PR, facing a confirmed
> deploy-blocking bug where `drizzle-orm`'s migrator applies all pending migrations in a single
> transaction — so `0028`'s safety guard fails against any pre-existing `completed` task with no
> `task_awards` row, and the whole transaction rolls back including `0027`'s creation of the
> `task_awards` table itself, permanently blocking boot on any environment with real historical
> completed tasks — we decided to split the two migrations across two separate PRs/deploys, with
> a manual `task_awards` backfill run against the target environment in between, to achieve a
> `0028` deploy that only ever runs against an already-populated `task_awards` table, accepting a
> slower, two-step rollout and a manual operational step between the two deploys.

- **Status:** Accepted
- **Date:** 2026-07-17
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —

## Context

PR #166 (`ponderingdemocritus/trace-split-task-ui`) originally bundled two migrations:
`0027_add_task_awards` (creates the `task_awards` table, no guard, cannot fail) and
`0028_drop_task_worker_rating` (drops `tasks.worker`/`tasks.rating`, gated by a `DO $$` block
that raises an exception if any `status='completed'` task with `verdict_type IS NULL` has zero
matching `task_awards` rows — see ADR-0006).

Reviewing this PR locally against a real local dev database (Postgres wired to the actual
deployed Base Sepolia testnet contract, with 128 real historical `completed` tasks predating
`task_awards`) reproduced a hard failure: every boot attempt failed at `0028`'s guard. Reading
`drizzle-orm`'s migrator (`node_modules/drizzle-orm/pg-core/dialect.js`, `PgDialect.migrate`)
confirmed why — it wraps every pending migration for a given boot into one
`session.transaction(...)` call. `0027` and `0028` are both pending together in this PR, so a
single boot attempt tries to apply both inside one transaction; `0028`'s guard fails against
real historical data, and the transaction rolls back in full, including `0027`'s `CREATE TABLE`.
There is no window in which the `task_awards` table exists (so the backfill script could
populate it) but `0028` has not yet run — both live or die together, every time, in the same
transaction.

Per ADR-0002, merging to `main` auto-deploys to the shared testnet, which already has real
completed tasks from before `task_awards` existed. Per ADR-0003, backend boot fails fast if
`migrate()` throws — `app.listen()` never runs. Deploying `0027`+`0028` together as currently
written would not degrade service, it would prevent the backend from ever starting on any
environment with pre-existing completed-task history, including the shared testnet and (later)
production.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Split `0027` and `0028` into two separate PRs/deploys, backfilling `task_awards` in between (chosen) | `0028` only ever runs against an already-populated table; no change to either migration's SQL or the guard's logic, which is correct and worth keeping; matches standard expand/contract migration practice | Two deploys instead of one; requires a manual operational step (running the backfill, or trusting boot's own reconciliation, and verifying zero `completedWithoutAwards`) between them, easy to forget without a documented runbook |
| Make `0028`'s guard auto-backfill instead of failing (rejected) | Single deploy, no manual step | A schema migration reaching out to an RPC endpoint and replaying on-chain history is a large scope increase for a `DO $$` block, cannot be done in a bounded, transaction-safe way within the same migration, and would make an irreversible `DROP COLUMN` depend on network/RPC availability at migration time |
| Remove `0028`'s guard entirely, accept silent data loss for unbackfilled tasks (rejected) | Single deploy, no manual step, no failure | Directly contradicts the reason the guard exists — this is exactly the class of silent, unrecoverable loss ADR-0006's migration was written to prevent for a first-ever `DROP COLUMN` |
| Keep both migrations in one PR, but run the backfill against the target database before merging (rejected) | Single deploy | Does not work: `0027` (which creates the table the backfill writes to) has not run yet at that point either — the backfill script itself fails with "relation task_awards does not exist" until `0027` is committed, and `0027` cannot be committed independently while it is bundled with `0028` in the same pending-migration transaction |

## Decision

`0028_drop_task_worker_rating.sql` and its `_journal.json` entry are removed from PR #166. The
PR now ships only `0027_add_task_awards` plus all app-code changes (indexer guards, the
forged-event fix, `claimedBy` unification, `primaryAward` projection) — none of which read or
write `tasks.worker`/`tasks.rating` any longer, so those columns are simply unused, not
load-bearing, once this trimmed PR deploys.

Rollout:

1. Merge and deploy the trimmed PR #166. `0027` applies alone — a plain `CREATE TABLE`, no
   guard, cannot fail against existing data.
2. Confirm `task_awards` is fully populated for the deploy target (testnet first, production
   later): either let boot's own reconciliation step catch it up, or run
   `make db backfill-task-awards` manually. Verify zero `completedWithoutAwards` via the same
   query `0028`'s own guard runs.
3. Open a follow-up PR containing only `0028_drop_task_worker_rating.sql` (unchanged SQL,
   re-added with a fresh `_journal.json` timestamp per this repo's migration-timestamp
   convention). Its guard now passes because the data gap is closed.
4. Merge and deploy the follow-up PR, following the same "before merging" rigor PR #166's
   checklist already established (CI green, timestamp refreshed immediately before merge,
   post-merge verification that the columns are actually gone and the guard did not skip
   silently).

## Consequences

**Positive:**
- `0028` can no longer fail on deploy against any environment, because it never runs until
  `task_awards` is already confirmed fully populated for that environment.
- Matches this repo's existing risk posture for a first-ever `DROP COLUMN` migration: prefer a
  slower, verified rollout over a single deploy that could crash-loop the shared testnet (or
  later, production) with no automatic recovery.

**A second, distinct bug found and fixed while verifying this split live:** even with the
deploy split and a fully-run backfill, `0028`'s guard still failed -- 35 tasks on a long-lived
local testnet database, 1 task on production. Both were completed tasks with no `task_awards`
row that the backfill legitimately could never resolve, because they belong to a *different*
contract deployment than the one currently configured (`contract_address` pointing at a
retired address, or `NULL` entirely, on a database with multiple historical deployments) --
the backfill only ever scans the app's currently-configured `CONTRACT_ADDRESS`, so those rows
were permanently out of its reach regardless of how thoroughly it ran. The guard's original
`DO $$` block had no contract scoping at all, so it counted every completed task in the table
irrespective of which contract created it. Fixed by deriving "the active contract" at guard
runtime from the data itself, rather than trying to hardcode an environment-specific address
into a migration file shared across environments.

The first version of that derivation picked whichever `contract_address` had the *most* tasks
-- wrong, and caught by checking a real testnet database rather than trusting the local
reproduction alone: an actively-redeployed testnet accumulates far more historical volume on
retired addresses than the current one has had time to collect (real numbers seen: 198
untracked, 38 on a retired address, only 35 on the actual active contract), so a most-common
vote confidently picked a retired contract as "active." Fixed by using the *most recently
created* task's `contract_address` instead -- unambiguously correct, since whichever contract
is creating new tasks right now is definitionally the active one regardless of accumulated
historical volume.

A third piece of work, prompted by wanting to actually recover data rather than just silence
the guard: `apps/backend/scripts/backfill-contract-address.ts` (service:
`contract-address-backfill.ts`) resolves each untracked task's true `contract_address` from its
own `escrow_tx_hash` receipt -- ground truth per task, decoding the `TaskCreated` log's emitting
address, rather than a guess. Run against the real testnet database: 193 of 198 untracked tasks
recovered (now correctly attributed to the active contract and reachable by the normal
`task_awards` backfill), 4 unresolved were `status='open'` (irrelevant to the guard), and 1
unresolved `completed` task turned out to belong to a genuinely different, even older
pre-architecture contract deployment (from this repo's earliest history) whose event ABI the
current decoder doesn't recognize -- correctly left alone rather than guessed at, and correctly
exempted by the guard either way since it isn't the active contract. Production's single
orphaned row was hand-verified and corrected the same way before this script existed (confirmed
via its escrow tx receipt that it genuinely belongs to the live contract, not a different
deployment).

**Negative / trade-offs:**
- Two deploys instead of one, with a manual verification step in between that is easy to skip
  or forget without discipline — mitigated by making that step an explicit, numbered item in
  this ADR and the follow-up PR's own "before merging" checklist.
- `tasks.worker`/`tasks.rating` remain in the schema, unused, for the duration between the two
  deploys — no functional risk (nothing reads or writes them after the trimmed PR #166 ships),
  but a reader of `schema.ts` alone during that window would not know they are already dead.

**Neutral / follow-up:**
- The follow-up PR containing `0028` must not merge until `task_awards` is confirmed fully
  backfilled against its deploy target (zero `completedWithoutAwards`) — that verification is
  the actual gate, not just this ADR's acceptance.
- If a future migration ever needs to both create a table and immediately depend on that table
  being non-trivially populated within the same deploy, this ADR's root cause (drizzle's
  single-transaction-per-boot migration model) applies again — the same split-and-backfill
  pattern should be used rather than trying to work around it inside one migration file.

## References

- PR #166 (`ponderingdemocritus/trace-split-task-ui`).
- ADR-0002 (testnet auto-deploys on merge to `main` — why this is a live risk, not just local).
- ADR-0003 (backend boot fail-fast — why a failed migration means the backend never starts).
- ADR-0006 (`task_awards` single source of truth — the migration this ADR splits).
- `apps/backend/drizzle/migrations/0027_add_task_awards.sql`,
  `0028_drop_task_worker_rating.sql` (held for the follow-up PR).
- `apps/backend/scripts/backfill-contract-address.ts`,
  `apps/backend/src/services/contract-address-backfill.ts` (the per-task `contract_address`
  recovery tool; `make db backfill-contract-address`).
- `apps/backend/src/services/configured-task-awards-backfill.ts`,
  `apps/backend/scripts/backfill-task-awards.ts` (the manual backfill path).
- `docs/DB_GUIDE.md` (`make db backfill-task-awards` and the reconciliation-on-boot behavior).
- `node_modules/drizzle-orm/pg-core/dialect.js` (`PgDialect.migrate` — confirms the
  single-transaction-per-boot behavior this ADR is built around).

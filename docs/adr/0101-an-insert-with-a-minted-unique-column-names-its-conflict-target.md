# 0101 — An insert carrying a minted unique column names its conflict target

> **Decision (Y-statement):** In the context of chain-indexing and intent-completion inserts that
> use `ON CONFLICT DO NOTHING` for replay safety, facing the fact that an untargeted clause
> swallows a violation of *any* constraint on the table and a newly-added unique column turns that
> into silent row loss, we decided that every insert carrying a randomly-minted unique column must
> name its conflict target explicitly, to achieve replay safety that cannot quietly become data
> loss, accepting that a genuinely conflicting value on some other unique constraint now raises
> instead of being discarded.

- **Status:** Accepted
- **Date:** 2026-08-18
- **Accepted:** 2026-08-18
- **Embodiment:** Verified
- **Last audited:** 2026-08-18
- **Author:** Claude Code (drafted for review)
- **Reviewers:** Beau Williams
- **Deciders:** Beau Williams
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** —
- **Pending Amends / Amended-by:** —

## Context

Two insert sites reach the `tasks` and `submissions` tables from paths that can legitimately run
twice: `processTaskCreatedEvent` in the indexer, replaying a `TaskCreated` log during a reseed or a
catch-up pass, and the submission intent completions, replaying after a reconciler observes the same
receipt. Both relied on `onConflictDoNothing()` with no target, which reads naturally as "if this
row is already recorded, carry on".

That reading is only correct while the primary key is the sole unique constraint that a re-run can
violate. Postgres applies an untargeted `ON CONFLICT DO NOTHING` to *every* unique constraint and
exclusion constraint on the table, so the clause means "discard this row on any uniqueness
violation whatsoever" — a much wider statement than the one the code intends.

ADR-0098 added a randomly-minted `reference_code` with a unique index to both tables. That changes
what the untargeted clause covers: a code collision, which is not "already recorded" at all, is now
also swallowed.

How bad that is depends on what follows the insert, and it is worth being exact rather than
asserting a uniform worst case across all three sites:

- **`processTaskCreatedEvent` (indexer) — silent.** The next statement is an `agents` insert with
  no foreign key onto the task row, so nothing downstream notices the absence. The task row is
  never written, the chain event is never indexed, no error is raised, nothing is logged. A
  one-in-a-trillion draw becomes lost chain state that surfaces much later as a task that exists on
  chain and nowhere else, with no evidence pointing at the cause.
- **`completeProofsAnchorDeliverable` — silent.** A bare insert with nothing after it, so the same
  shape: the submission row simply never exists.
- **`completeSubmissionsSubmit` — not silent, but misattributed.** The `artifacts` insert runs next
  in the same transaction and `artifacts.submission_id` references `submissions.id`; the handler
  already throws earlier if the payload carries no artifacts. A dropped submission row therefore
  hits a foreign-key violation on the very next statement and rolls the transaction back. The
  failure was always loud here — it just named the wrong cause. Targeting the conflict converts a
  confusing FK error into an accurate one rather than converting silence into an error.

Two of the three are genuinely silent, which is what carries the decision. The third is included
because a rule that holds at two of three sites and is waived at the third by an accident of
statement order is not a rule anyone can apply without re-deriving it each time.

For those two, the probability is negligible and the consequence is unbounded and silent. That
combination is exactly what the codebase has already been bitten by once: the `task_drop_id`
migration incident recorded in `AGENTS.md` was also a silent skip with no error at the point of
failure.

There is a second, smaller consequence worth stating plainly rather than discovering later. On
`tasks`, `escrow_tx_hash` also carries a unique constraint. Under the untargeted clause, two
different task ids sharing one escrow transaction hash were silently discarded; under a
primary-key target they raise. That case should not occur — one transaction creates one task, so
the id and the hash move together — and if it ever did it would be data corruption worth hearing
about rather than dropping.

### What a raised collision costs the intents engine

Two of the three sites are relayed-intent completion handlers, so the question "what happens when
this now throws instead of swallowing" has a specific answer.
`completeRelayedIntent` in `services/relayed-intent-registry.ts` wraps the handler call: a throw is
caught, logged as `Relayed intent completion failed`, recorded on the intent row via
`recordIntentCompletionError` (`status: 'failed'`, `lastError` populated), and reported as a failed
completion. It is not a crash, and it is not an unbounded retry.

So the trade for the intents engine is narrow and favourable: the row is missing either way, and
what changes is whether anyone can find out. Before, the intent was marked *completed* with the row
absent — a confirmed on-chain `submitWork` or `TaskCreated` with nothing behind it and no record of
why. After, the intent is marked *failed* with the reason attached to it.

The fourth path that writes `tasks`, `completeTasksCreate`, already used
`onConflictDoUpdate({ target: tasks.id, ... })` — `ON CONFLICT DO UPDATE` cannot be untargeted in
Postgres — so it was compliant before this decision and needed no change. With the three sites
above, every insert in the codebase carrying a minted unique column now names its target.

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| Name the conflict target explicitly on any insert carrying a minted unique column | Replay safety keeps its intended meaning; a collision surfaces as an error rather than as lost chain state; the rule generalises to any future minted identifier | Changes behaviour for a genuinely conflicting value on another unique constraint, from silent discard to a raised error |
| Leave the clause untargeted and rely on collision probability (rejected) | No change to any existing path; nothing to review | Accepts an unbounded, silent, unattributable failure in exchange for avoiding a one-line change; the probability argument does not survive the table growing or the alphabet changing |
| Mint the code in a separate `UPDATE` after the insert (rejected) | Insert semantics untouched entirely | Leaves a window where a row has no public name, and needs its own reconciliation for rows that fail between the two statements — more moving parts than the problem has |
| Derive the code deterministically so collisions are impossible (rejected) | No uniqueness question at all | Rejected by ADR-0098 for its own reasons: a derived code is invalidated for every user who wrote it down whenever the derivation changes |
| Drop the unique index and deduplicate in application code (rejected) | The untargeted clause stays correct | Moves a guarantee the database can make into code that must remember to make it; a duplicated public name is exactly the failure the index exists to prevent |

## Decision

Any insert that carries a randomly-minted column protected by a unique index must name its
conflict target explicitly. Where the intent is replay safety, the target is the primary key.

An untargeted `ON CONFLICT DO NOTHING` is acceptable only on a table whose primary key is its sole
unique constraint, and adding a unique column to such a table obliges the author to revisit every
insert against it.

## Consequences

**Positive:**

- Replay safety keeps the meaning the code intends, and cannot quietly widen into "discard the row
  on any uniqueness violation" when a column is added years later.
- A reference-code collision raises where it happens, instead of producing a task that exists on
  chain and nowhere else with nothing pointing at the cause.
- The rule generalises: it is a property of minted unique columns, not a fact about these two
  tables, so the next table with a public identifier inherits it.

**Negative / trade-offs:**

- A genuinely conflicting `escrow_tx_hash` on `tasks` now raises rather than being discarded. This
  should be unreachable, and is asserted as a boundary rather than left as an argument.
- Authors adding a unique column to an existing table now carry an obligation to audit its inserts.
  Nothing enforces that automatically.

**Neutral / follow-up:**

- **The change landed in this branch ahead of this decision.** It was made inline while
  implementing ADR-0098, where it read as an implementation detail of adding the column; it is not
  one, which is why this ADR exists. Accepted after the fact rather than before, and recorded that
  way rather than backdated.

- **The per-site failure analysis in Context was written after the fact too, and corrected one.**
  The first draft asserted a uniform silent failure across all three sites. Reading each one showed
  `completeSubmissionsSubmit` was never silent — the `artifacts` foreign key catches it on the next
  statement. The decision survives on the two sites that genuinely were, and the third is included
  for uniformity rather than because it was losing data.

- Both behaviours are pinned by tests in
  `test/integration/services/indexer-status-guards.test.ts`: a replayed `TaskCreated` stays a no-op
  and does not re-mint a code someone may already have quoted, and a conflicting `escrow_tx_hash`
  surfaces.
- No linter checks this. If untargeted conflict clauses spread, a rule over `onConflictDoNothing()`
  with no argument would be the place to catch it.

## References

- Reference codes, which introduced the unique columns: ADR-0098
- Task-row write paths this governs: ADR-0055 (receipt-derived id), ADR-0029 (reconciliation insert)
- Indexer durability posture: ADR-0003, ADR-0005, ADR-0007
- Silent-skip precedent this reasoning draws on: the `task_drop_id` migration incident in
  `AGENTS.md`

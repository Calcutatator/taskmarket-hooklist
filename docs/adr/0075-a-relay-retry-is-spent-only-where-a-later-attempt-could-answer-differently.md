# 0075 — A relay retry is spent only where a later attempt could answer differently

> **Decision (Y-statement):** In the context of a relay loop that retries every failed attempt six
> times regardless of what failed, facing a deterministic revert that consumed the whole budget --
> six attempts, five nonces and about thirty seconds -- to arrive at the answer the first attempt
> already had, we decided to give a decoded revert a short budget of its own rather than the
> transient one, to achieve a loop that spends attempts where a later one could answer differently,
> accepting that a revert caused purely by read-after-write lag now has fewer attempts to recover
> in than it does today.

- **Status:** Accepted
- **Date:** 2026-08-08
- **Accepted:** 2026-08-08
- **Embodiment:** Verified
- **Last audited:** `[unaudited]`
- **Author:** Claude Code (drafted for review)
- **Deciders:** Beau
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** Amends ADR-0047
- **Pending Amends / Amended-by:** —

## Context

`relayThroughForwarderResult` retries a failed attempt `RELAY_MAX_RETRIES = 6` times at
`RELAY_RETRY_DELAY_MS = 6000` apart. The constants carry their own justification, and it is a good
one:

```
// Retry config for relay simulation failures (RPC read-after-write lag).
// 6 attempts, 5 gaps of 6s = ~30s total retry window -- sized against Base's
// ~12s block time. Only helps if the failure is transient lag; a persistent
// revert still fails after exhausting the window.
```

The window exists for one failure: a node that has confirmed a receipt but whose simulation still
reads pre-transaction state, so a call that will succeed reverts for a reason that is true only
right now. Retrying that is right.

**The sizing in that comment is wrong, and it is worth correcting here because it is the only
stated basis for the budget.** Base is an OP Stack chain with ~2s blocks -- 12s is Ethereum L1's
block time, not Base's, and `cloud-env-setup.sh` runs Anvil at `--block-time 1`. So the arithmetic
is not what the comment claims:

| | comment's claim | actual on Base |
| ------ | ------ | ------ |
| one 6s retry gap | half a block | ~3 blocks |
| the full 30s budget | ~2.5 blocks | ~15 blocks |

The loop is not holding two and a half blocks of slack for a node to catch up. It is holding
fifteen. Read-after-write lag that outlives fifteen blocks is not lag; it is a node that is
broken, and waiting is not the remedy for that.

The last clause is where the cost sits. "A persistent revert still fails after exhausting the
window" is accurate, and it means the budget is spent in full on every failure that could never
have succeeded. A sandbox run made this visible: a deterministic out-of-gas revert consumed all six
attempts on every affected submission, and the thirty-second signature was identical on three
separate runs, because it is not a property of the write at all -- it is the loop's fixed cost.

Two things follow, and only one of them is a defect:

- **The reporting was wrong, and is fixed.** ADR-0074 established that an exhausted loop with
  nothing decoded reports in flight rather than a rejection. That is settled and this decision does
  not revisit it.
- **The spending is still indiscriminate.** Five extra attempts against an answer the chain already
  gave costs five nonces from the database-coordinated allocator (ADR-0040) and thirty seconds of a
  request the caller is waiting on, to reach the identical verdict.

`classifyRelayFailure` (ADR-0047) already draws exactly this distinction one layer up, for the
reconciler: `deterministic` means the chain rejected the call on its own terms, `transient` means no
verdict was reached. The relay loop predates that classifier being available here and does not
consult it. Nothing about the two failures is genuinely indistinguishable at the point of the throw
-- the loop simply never asks.

**The catch, and the reason this is a decision rather than a fix.** The lag case *produces a decoded
revert*. A node reading pre-transaction state answers `SubmissionNotFound` with the contract's own
vocabulary, and `classifyRelayFailure` correctly calls that `deterministic`, because at that instant
it is. So "stop retrying deterministic reverts" would remove retries from precisely the case the
window was built for. The classifier separates *what the chain said*; it cannot separate *whether
saying it again would say something else*.

## Considered options

| Option | Pros | Cons |
| ------ | ---- | ---- |
| **A short budget for a decoded revert, the full one for everything else** (chosen) | Spends attempts in proportion to the chance a later one differs. Lag recovers inside a block or two, so two attempts covers the case the window exists for while cutting a doomed call from six attempts to two. Uses the classifier ADR-0047 already established rather than inventing a second vocabulary | A lag episode lasting longer than one retry gap now fails where it previously recovered. The budget is a guess at a distribution nobody has measured |
| Leave the loop as it is (rejected) | No change, no risk to lag recovery, and the cost is bounded and already understood. Now that ADR-0074 fixed the reporting, nothing about this is a correctness defect | Every deterministic failure keeps paying five nonces and thirty seconds for an answer already in hand. The allocator gap those nonces leave is the exact resource ADR-0040 exists to protect |
| Stop retrying a decoded revert entirely (rejected) | Simplest rule, and the largest saving | Removes retries from the lag case, which is the only reason the loop exists. The lag case is indistinguishable from a permanent revert *at the moment of the throw*, so this trades a known small waste for an unknown failure rate on writes that would have succeeded |
| Retry only when the node's block number advanced since the last attempt (rejected for now) | The most correct rule available: "lag" means the node is behind, and a block boundary is the event that could change the answer. Would separate the two cases on evidence rather than on a budget | An extra RPC read per attempt on the failure path, and it assumes block advance is what clears the lag -- plausible, unverified. Worth doing, but not worth blocking this on: it is a refinement of the same direction, and can amend this decision once the cheaper form has run in production |
| Make both budgets configurable and tune per environment (rejected) | Defers the judgement to whoever has the data | A knob is not a decision, and an unset knob is this file's default anyway. Adds a configuration surface whose wrong setting is silent |

## Decision

The relay loop consults `classifyRelayFailure` on each failed attempt and spends its budget
accordingly:

1. A failure classified `transient` keeps the existing budget: `RELAY_MAX_RETRIES = 6` attempts at
   `RELAY_RETRY_DELAY_MS` apart.
2. A failure classified `deterministic` -- a decoded revert -- gets `RELAY_DETERMINISTIC_MAX_RETRIES
   = 2` attempts at the same delay. One retry, one block boundary, which is the window the lag case
   needs and the whole of what a permanent revert can use.
3. The classification is per attempt, not per call. A call whose first failure is a timeout and
   whose second is a revert is bounded by the deterministic budget from the revert onward, because
   the most recent evidence is the relevant one.
4. Nothing about what is *reported* changes. An exhausted loop still raises `UndeterminedRelayError`
   when nothing decoded and still throws the decoded reason when something did (ADR-0074). This
   decision governs only how many attempts are spent before that happens.

Two attempts means one 6s gap, which on Base's ~2s blocks is about three block boundaries -- already
generous for a lag episode that normally clears in one. Each further attempt buys another three
blocks of waiting for a case that has either resolved long since or never will, which is why the
budget is 2 rather than 3 or 4. It is not 1, because 1 is the rejected option above: no retry at all,
and no recovery from the case the loop exists for.

## Consequences

**Positive:**

- A deterministic revert costs 2 nonces instead of 6, and about 6 seconds instead of 30. The saving
  is largest exactly where the failure is most repetitive, which is where the allocator gap hurts
  most (ADR-0040).
- The relay loop and the reconciler now answer the same question with the same classifier rather
  than with two independent rules, so a change to what counts as deterministic reaches both.
- The caller of a doomed write waits seconds rather than half a minute for a verdict that was
  available immediately.

**Negative / trade-offs:**

- **A lag episode longer than one retry gap now fails where it previously recovered.** This is the
  real cost and it is not hypothetical -- it is the same case the window was built for, given a
  smaller window. The failure is safe rather than silent (it surfaces as ADR-0074's in-flight state,
  and settlement still owns the transaction), but a write that would have succeeded on attempt four
  now does not.
- The budget of 2 is a judgement about a distribution nobody has measured. It is defensible from the
  block time and no stronger than that.
- **The `transient` budget of 6 is left untouched but is oversized on the same corrected
  arithmetic** -- 30s is ~15 Base blocks. It is not changed here because nothing has been observed
  to suffer from it and this decision is about the path that has. Anyone revisiting it should know
  the original 12s premise was wrong.

**Neutral / follow-up:**

- The block-number rule tabled above is the principled version of this decision and should amend it
  once there is production evidence about how long lag episodes actually last. Recording the
  distribution of retry-attempt-at-success is the cheapest way to get that evidence, and it is worth
  doing whichever budget is in force.
- No schema change, no API change, no change to any error a caller receives.

## References

- [ADR-0040 — server wallet transactions use a database-coordinated dispatcher](0040-server-wallet-transactions-use-a-database-coordinated-dispatcher.md)
- [ADR-0047 — evaluator assignment is its own intent and chaining is withdrawn](0047-evaluator-assignment-is-its-own-intent-and-chaining-is-withdrawn.md)
- [ADR-0074 — an undecodable relay failure is reported as in flight, not as a rejection](0074-an-undecodable-relay-failure-is-reported-as-in-flight-not-as-a-rejection.md)
- `apps/backend/src/services/contract.ts` — `relayThroughForwarderResult`, `RELAY_MAX_RETRIES`.
- `apps/backend/src/lib/relay-failure.ts` — `classifyRelayFailure`.

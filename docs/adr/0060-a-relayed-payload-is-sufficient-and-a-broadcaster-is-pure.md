# 0060 — A relayed payload is sufficient, and a broadcaster is pure

> **Decision (Y-statement):** In the context of relayed writes replayed verbatim from a durable
> intent, facing a payload-sufficiency rule that ADR-0050 states but nothing enforces — and that
> review has already missed five times on one branch — we decided to state the rule in its own
> right and enforce the half of it that is mechanically decidable, by requiring the transitive call
> graph rooted at every registered `broadcast` to read nothing but its own arguments, to achieve a
> replay path that cannot silently substitute today's state for what the payer authorised,
> accepting that payload-side derivation and completion-handler reads remain a review
> responsibility because no syntactic property distinguishes them.

- **Status:** Accepted
- **Date:** 2026-08-04
- **Embodiment:** Verified
- **Last audited:** 2026-08-04
- **Author:** Claude Code (drafted for review)
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** Amends ADR-0050
- **Pending Amends / Amended-by:** —

## Context

ADR-0050 point 7 fixes everything about a relayed write except gas, and says a payload is replayed
verbatim on any rebroadcast. It also states the corollary, in one sentence near the end: *a payload
that would be actively wrong on replay is a signal that the payload is carrying something it should
not.*

That corollary is the operative rule for anyone writing a new relayed operation, and it is stated
as an aside to a decision about retry policy. Two obligations follow from it, and neither is
written anywhere as an obligation:

1. **A payload must contain everything its call needs.** If the broadcaster has to go and find a
   value, the payload was insufficient.
2. **A payload must contain nothing derived from state that can move** between the request and a
   rebroadcast hours later.

### The rule has failed five times, and review caught every one

On the branch implementing ADR-0045 through ADR-0059 alone:

- **`acceptance.accept` omitted the deliverable hash.** Re-resolving it at completion picks the
  newest unrejected submission. On a bounty, that is *a different worker's work* — the requester
  accepts one submission and the chain pays for another.
- **`evaluations.resolveDispute` stored `firstAwardWorker`**, a projection of the verdict rather
  than the awards and the verdict themselves, so the intent could not reproduce its own call.
- **`tasks.update` carried no `currentReward`**, which sizes the delta the forwarder pulls.
  Re-reading it would size the transfer against a row a confirmed first attempt may already have
  moved.
- **`tasks.create` carried a *predicted* `taskId`** from a nonce read before the call, so a
  rebroadcast could name a different real task and the completion would overwrite it. ADR-0055
  fixed this one specifically; the class it belongs to was not addressed.
- **Several payloads lacked `contractAddress`, a sender, or an agent id.**

Every one was found by a human reading carefully. Five in one branch is not a run of bad luck; it
is the expected yield of a consequential rule whose only enforcement is attention. Each of these is
also silent in exactly the way that makes it dangerous — the defect appears only on the rebroadcast
path, which by construction runs when nobody is watching, and produces a transaction that succeeds
on chain while doing the wrong thing.

This is the last of the six invariants on this branch with no structural guard. The other five —
broadcaster coverage, server-wallet dispatch, guard release, payment reference, orphaned-payment
decision, error envelope — all live in `apps/backend/test/unit/config/`.

### Not all of the rule is checkable

The rule has three candidate enforcement points, and they are not equally decidable:

- **A broadcaster reads only from the intent row.** Decidable. A broadcaster is by definition the
  replay path, and its call graph is closed: it reaches the world only through calls, and each call
  either resolves to a function a checker can follow or to a terminal module on an allowlist.
- **A completion handler must not read mutable database state to derive a value it writes.** Not
  decidable. A completion handler *legitimately* reads the database — `completeEvaluationsEvaluate`
  selects the task for its appeal window — and *legitimately* reads the chain keyed on the
  confirmed hash, which is stable across attempts precisely because the hash is. Telling a stable
  tx-keyed read from a mutable state-keyed one requires knowing what a value means, not what shape
  it has.
- **No payload field is derived from a value the request read and a first attempt could change.**
  Not decidable. The derivation happens in the router, which is allowed to read anything, and no
  syntax distinguishes "read a column and recorded it" from "read a column that a confirmed first
  attempt already moved".

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| State the rule as its own decision, and enforce the broadcaster-purity half structurally; leave the other two halves to review, documented as such (selected) | Catches every one of the five historical defects, because each required either an insufficient payload the broadcaster compensated for or a broadcaster reading around it; the guard is exact rather than heuristic, so it does not misfire and does not get deleted; the two undecidable halves are named in the test itself, so nobody mistakes a passing run for full coverage | Does not catch a payload field the *router* derived badly and the broadcaster then faithfully replays; a reviewer who reads "the invariant has a guard" without reading which part of it is guarded is worse off than one who knows there is none |
| Enforce all three halves with a heuristic (flag any database read in a completion handler, any router read feeding a payload field) | Would in principle cover the whole rule | Every completion handler reads the database legitimately, so the flag fires on correct code from day one. A structural test that misfires gets argued with, then exempted, then deleted — and a deleted guard is worse than no guard, because people assume it is still there. A previous agent on this branch made exactly this argument about an inferred list and was right |
| Leave the rule in ADR-0050 point 7 and rely on review | No new machinery; the rule is already written down | It is the mechanism that has already failed five times on one branch. Review is the right mechanism for the undecidable half and the wrong one for the half a parser can settle |
| Enforce purity by convention — a comment on each broadcaster asserting it | Cheap; documents intent at the site | Asserts nothing. A comment does not fail a build, and the five defects all shipped with careful, sincere comments around them |

## Decision

**1. The payload-sufficiency rule is a decision in its own right, not a corollary.** A relayed
payload must contain everything its call needs, and nothing derived from state that can move
between the request and a rebroadcast. When a broadcaster appears to need a value it does not have,
the fix is to record that value in the payload at request time — never to fetch it at broadcast
time.

**2. A registered broadcaster is pure over the intent row.** Its transitive call graph may read its
own arguments and nothing else: not the database, not the clock, not a random source, not a fresh
chain read. It may read only intent-row fields that are written once before the chain call and
never rewritten — `payload`, `payer`, `paymentTxHash`, `id`, `operation`, `createdAt`. Fields that
move between attempts — `txHash`, `status`, `broadcastAttempts`, `completionAttempts`, `lastError` —
are off limits, because a broadcaster reading one of them would send a different transaction on a
rebroadcast than it sent the first time.

**A consequence worth stating, because it is a stronger property than the correctness argument
alone:** a broadcaster obeying this makes **no RPC calls at all** on the replay path beyond the
send itself. The rebroadcast sweep is therefore not merely correct but cheap and independent — it
cannot fail, stall, or return stale data because some read-path RPC was degraded, and its behaviour
does not depend on chain reachability for anything except the one transaction it is there to send.
An intent stuck at `recorded` is replayed from bytes.

**3. `services/contract`'s tx-keyed reads are banned in a broadcaster and allowed in a completion
handler**, and this is not an inconsistency. `blockNumberForTx`, `blockTimestampForTx`,
`taskIdForTx` and `contractProjectSettlementForTx` are keyed on a *confirmed transaction hash*, so
they return the same answer forever and are stable across attempts — which is exactly why a
completion handler is the right place for them (ADR-0055 moved the created task id onto this
footing deliberately). In a broadcaster there is no confirmed hash yet, so the only thing such a
read could be keyed on is live state.

**4. Enforcement is structural for the broadcaster half and review for the rest, and the boundary
is written where the enforcement lives.**
`apps/backend/test/unit/config/relayed-intent-broadcast-purity.test.ts` walks the call graph rooted
at every `broadcast` registered in `services/intents/register.ts` and fails on anything impure. It
checks three things: that no broadcaster binds `db` out of the registry context; that no broadcaster
reads a mutable intent-row field; and that nothing in the transitive call graph references a blocked
name or calls into a module the test cannot follow.

**An unresolvable call is a finding, not a pass.** This is what makes the closure hold for code
nobody has written yet: a broadcaster that reaches a package the test cannot read is a broadcaster
nobody can claim is replayable, so the test says so rather than assuming the best. The alternative —
skipping what it cannot resolve — would make the guard decay silently as the codebase grows, which
is the failure mode that makes structural tests untrustworthy.

The test also states, in its own header comment, precisely what it does *not* catch. That placement
is deliberate: the limits of a guard belong where someone reads the guard, not only in an ADR they
may never open.

**5. Where a genuine future broadcaster needs a new terminal module or global, the allowlists are
extended deliberately and in review** — that is the intended way to pass, and it keeps each
extension a visible decision rather than a silent one. What is not available is an exemption list of
operations, for the reason ADR-0050's broadcaster-coverage test already records: a list of excuses
is where a temporary gap becomes permanent.

## Consequences

**Positive:**

- The five defect classes above now fail a test rather than depending on a reviewer's attention. A
  deliberate reintroduction of the `acceptance.accept` deliverable-hash defect fails on two
  independent assertions, not one.
- The replay path makes no reads. Rebroadcast becomes a pure function of stored bytes, so it is
  unaffected by RPC degradation and cannot serve stale state.
- The rule is stated where a rule belongs, instead of being an aside inside a decision about retry
  policy — so the next person adding a relayed operation can find it by looking for it.
- The undecidable half is named rather than implied, so a passing test is not mistaken for full
  coverage of the invariant.

**Negative / risks:**

- A payload field derived badly in the router, then faithfully replayed, still passes. This is the
  residual risk and it is real: `tasks.update`'s missing `currentReward` would have been caught
  (the broadcaster would have had to read it), but a `currentReward` recorded from a stale read
  would not be. Review remains the only mechanism there.
- The terminal-module allowlist is a maintenance surface. It is small and deliberately so, and an
  addition to it should be argued in review rather than waved through as a build fix.

**Neutral:**

- The guard is a unit test with no runtime cost and no production code path. It carries `Verifies:`
  rather than `Implements:`, so it does not trip `adr-lint`'s Proposed-ADR gate while this ADR
  awaits a human Decider.

## References

- ADR-0045 — relayed writes are durable intents, not request-scoped transactions
- ADR-0050 — point 7, from which this decision is extracted and which it amends
- ADR-0054 — on-chain guards that made `tasks.update` and `tasks.refundExpired` replayable
- ADR-0055 — a created task id comes from the receipt, not a nonce prediction
- ADR-0057 — a settled payment is one indivisible reference
- `apps/backend/test/unit/config/relayed-intent-broadcast-purity.test.ts` — the guard
- `apps/backend/test/unit/config/relayed-intent-broadcaster-coverage.test.ts` — the sibling guard
  whose shape this follows

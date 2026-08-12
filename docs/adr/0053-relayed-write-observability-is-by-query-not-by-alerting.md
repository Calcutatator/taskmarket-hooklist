# 0053 — Relayed-write observability is by query, not by alerting

> **Decision (Y-statement):** In the context of the durable relayed-intent settlement layer, where
> seven ADRs each left "alerting on stuck, exhausted or orphaned records" as an open follow-up,
> facing a choice between building a push-based operator alerting channel and deciding not to, we
> decided that observability for this subsystem is by query — the payer-scoped intent-status surface
> for callers, direct queries over the durable tables plus structured error logs for operators — and
> that no alerting channel will be built, to achieve one observability model for the whole subsystem
> instead of two, accepting that nothing tells anybody when something goes wrong and a stuck record
> is noticed only when somebody looks.

- **Status:** Accepted
- **Date:** 2026-08-03
- **Accepted:** 2026-08-03
- **Embodiment:** Implemented
- **Last audited:** 2026-08-03
- **Author:** Claude Code (drafted for review); decision made directly by Beau in conversation
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** —
- **Pending Amends / Amended-by:** —

## Context

Seven ADRs in the relayed-intent series each end by naming alerting as unbuilt and out of scope:

- **ADR-0040** — alerting on replacement frequency, so a nonce being repeatedly replaced is noticed.
- **ADR-0045** — "intents can accumulate in non-terminal states and need alerting, the same way
  `server_wallet_transactions` rows do."
- **ADR-0046** — a chain stalled with an unstarted follow-on should be treated like an intent stuck
  in `recorded`. (The chaining subsystem was later withdrawn by ADR-0047; the observability point
  outlived it.)
- **ADR-0047** — alerting on intents that reach a terminal failure.
- **ADR-0048** — "alerting on rows left in `refund_status = 'failed'` is still not built. The retry
  script has always been run because a human noticed something, never because something told them."
- **ADR-0050** — "alerting on intents that exhaust their bound is not built, and matters more now
  than before: an exhausted intent is a payer who waited and then got refunded anyway."
- **ADR-0051** — alerting on a nonce that has reached the gas cap and stayed there, which is the
  signal distinguishing "congested" from "something else is wrong".

Seven deferrals is not seven oversights. It is a decision nobody was making, restated each time the
question came up, and left open because closing it looked like it needed infrastructure. Meanwhile
the subsystem has grown from one paid path to every relayed write in the product, so the amount of
work now happening in background processes — where nobody is waiting and no request will report a
failure — has grown with it.

**ADR-0049 already answered this question for one audience.** Asked how a payer learns that their
in-flight write settled or their payment was refunded, it chose polling over push, and rejected push
explicitly rather than deferring it: a delivery endpoint per payer, retry and backoff, an
at-least-once contract, and a security review of pushing payment-bearing facts to a caller-supplied
URL is "a subsystem, for a notification". It also observed that a queryable surface is required
either way, because a client that missed a push still needs somewhere to ask.

Every one of those arguments transfers to the operator audience, and one more applies only here:
**two observability models for one subsystem is worse than either alone.** If callers poll and
operators are pushed to, then every future record type in this series needs someone to decide which
model it belongs to, and the answer will be inconsistent because the question is genuinely
ambiguous — an orphaned payment is simultaneously a payer's problem and an operator's.

**What exists today, and is not nothing.** Every terminal-failure site already emits a structured
`logger.error` with the intent id, operation and reason: `dispatchRelayedIntent` on a deterministic
revert, `completeRelayedIntent` on a handler failure or a missing handler, `releaseIntentGuard` on a
failed guard release, `settleIntent` and the confirmed-intent sweep in the reconciler, and
`replaceStuckNonce` on a failed replacement. The durable tables — `relayed_intents`,
`server_wallet_transactions`, `orphaned_payments`, `dreams_withdraw_nonces` — are themselves the
operational surface, and the sandbox reports on this branch have repeatedly used exactly those
queries to establish what happened. `retryFailedOrphanedRefunds` and
`scripts/retry-orphaned-refunds.ts` remain the recovery tool.

The gap is not that the facts are unavailable. It is that nothing volunteers them.

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| Observability is by query for both audiences; no alerting channel is built (selected) | One model for the whole subsystem, so no future record type needs a routing decision; consistent with ADR-0049's already-decided answer for payers, and consistency here is worth more than the marginal value of a channel; needs no delivery infrastructure, no retry semantics, no at-least-once contract, and no security review of push destinations; the durable tables and structured logs already answer every question an alert would raise, and have been used to do so; a decision closes seven open follow-ups that were each going to be reopened | Nothing tells anybody when something goes wrong. A stuck intent, a failed refund, or a nonce pinned at the gas cap is noticed when somebody looks, and if nobody looks it is not noticed at all. The specific case this is worst for is an exhausted intent: a payer waited, was refunded anyway, and no operator learns that happened |
| Build operator alerting now (rejected) | A stuck record surfaces without anyone having to ask; the exhausted-intent case is exactly the kind of thing worth being told about; the seven ADRs each independently thought it was worth naming | It is a subsystem, not a feature: a channel, delivery guarantees, retry and backoff, deduplication so a persistently stuck row does not page hourly, thresholds that need tuning against real traffic nobody has yet, and a decision about where it delivers. ADR-0047 records the cost of building machinery ahead of the need, and this is that trade again. It also creates the two-model problem: callers poll, operators are pushed, and every new record type needs an arbitrary routing decision |
| Leave it open, as the seven ADRs did (status quo, rejected) | Costs nothing today; keeps the option alive without committing | Seven deferrals demonstrate this does not converge. Each new ADR in the series pays the cost of restating it, and a reader cannot tell whether alerting is coming, was rejected, or was forgotten — which is the worst of the three states to be in, because it stops anyone either building it or designing around its absence |
| Build a minimal digest — a periodic summary of non-terminal records — instead of real-time alerting (rejected for now) | Much cheaper than alerting; no per-event delivery guarantees; would catch the exhausted-intent case within a day | Still a delivery channel with a destination and a failure mode of its own, and it answers a question a query already answers, for an operator population currently of one. Worth revisiting as an addition if the accepted cost below turns out to bite; it is not a different enough answer to justify building ahead of that evidence |

## Decision

**1. Observability for the relayed-intent settlement layer is by query.** Callers use the
payer-scoped intent-status surface (ADR-0049). Operators query the durable tables directly and read
the structured error logs already emitted at every terminal-failure site. No alerting channel,
webhook, page, digest or notification is built for this subsystem.

**2. This closes the alerting follow-up in ADR-0040, ADR-0045, ADR-0046, ADR-0047, ADR-0048,
ADR-0050 and ADR-0051.** Those follow-ups are answered, not deleted: each remains readable in place,
and this ADR is the answer. **No amendment or supersession is claimed against any of them.** Deciding
an item a decision explicitly declared open does not change that decision — the same reasoning
ADR-0048 applied when it closed a gap ADR-0045 and ADR-0047 had left, and declined to claim an
amendment for it.

**3. Structured error logging at terminal-failure sites is the load-bearing part and must stay.**
The decision not to alert is only defensible because the facts are recorded where somebody looking
can find them. Any future terminal-failure path — a new operation kind, a new settlement branch —
carries the same obligation: log the intent id, the operation and the reason, at `error` level, at
the point the terminal state is written. Removing or downgrading one of those is a real regression
against this decision, not a logging tidy-up.

**4. The cost is accepted explicitly, and the worst case is named.** Nothing volunteers a problem.
The case this serves worst is an intent that exhausts its retry budget: the payer waited, was
refunded rather than served, and no operator finds out unless they query. That is a genuinely worse
outcome than being told, and it is accepted because the alternative is a delivery subsystem built
ahead of any evidence about how often it would fire.

**5. What would reopen this.** Evidence, not discomfort: an incident where a stuck or exhausted
record went unnoticed long enough to matter, or an operator population large enough that "somebody
looks" stops describing anyone in particular. Either is a reason to revisit with real numbers about
frequency and cost. Anticipating it is not.

## Consequences

**Positive:**

- One observability model for the whole subsystem. No future record type needs a routing decision
  between polling and push, and no reader has to learn which records behave which way.
- Consistent with ADR-0049, so the payer-facing and operator-facing answers rest on the same
  reasoning rather than contradicting each other.
- Seven open follow-ups are closed by a decision, so the next ADR in this series neither restates
  them nor leaves a reader guessing whether alerting is coming.
- No delivery infrastructure to build, secure, tune or operate — and no alert thresholds guessed
  against traffic patterns nobody has measured.
- The queries that answer these questions are already in use and already proven: the sandbox reports
  on this branch establish exactly this class of fact from exactly these tables.

**Negative / trade-offs:**

- **Nothing tells anybody when something goes wrong.** This is the whole cost and it is not
  mitigated, only accepted.
- An exhausted intent — a payer who waited and was refunded anyway — is invisible until queried.
  ADR-0050 called this "the outcome most worth knowing about", and this decision leaves it unknown
  by default.
- A slow degradation is the hardest case: one stuck nonce a week is exactly the pattern a query run
  by a human on no schedule will miss, and exactly the pattern an alert would catch.
- Operator recovery still depends on a human noticing, which ADR-0048 already observed about
  `retryFailedOrphanedRefunds`: "the retry script has always been run because a human noticed
  something, never because something told them." That stays true, now by decision rather than by
  omission.

**Neutral / follow-up:**

- **Embodiment is `Implemented`, not `Verified`, and the gap is the point.** The sites this
  decision depends on now carry `Implements: ADR-0053` markers, so the audit can see them and
  drift will fire if they are deleted. What does not exist is a test that asserts the logging is
  actually *there* -- `Verified` requires a `Verifies:` reference and there is nothing to point
  at. Point 3 calls the structured error logging load-bearing; until a structural test asserts
  every terminal-failure write is accompanied by an error log, that claim is enforced by review
  alone, which is the standard this repo has repeatedly found insufficient. Writing it is the
  natural next step and would move this to `Verified` honestly.

- A periodic digest remains the cheapest way to buy back most of what is given up here, and is
  rejected only ahead of evidence. If the accepted cost bites, it is the first thing to reach for,
  and it is additive rather than a reversal.
- Whether the payer-scoped intent-status surface should also serve an operator-scoped view — the
  same data without the payer filter, behind an operator credential — is not decided here. It would
  be a convenience over queries that already work, not a new capability.
- Log aggregation and retention are an infrastructure question outside this subsystem. This decision
  assumes the structured errors are findable; if they are not, that is a platform gap worth its own
  attention, and it would undermine point 3.

## References

- [ADR-0040 — Server-wallet transactions use a durable nonce allocator and outbox](0040-server-wallet-transactions-use-a-database-coordinated-dispatcher.md)
- [ADR-0045 — Relayed writes are durable intents, not request-scoped transactions](0045-relayed-writes-are-durable-intents-not-request-scoped-transactions.md)
- [ADR-0047 — Evaluator assignment is its own intent, and the chaining subsystem is withdrawn](0047-evaluator-assignment-is-its-own-intent-and-chaining-is-withdrawn.md)
- [ADR-0048 — Orphaning a payment is decided only by intent settlement; the ledger is retained](0048-orphaning-a-payment-is-decided-only-by-intent-settlement.md)
- [ADR-0049 — In-flight paid writes are observable through a dedicated intent-status surface](0049-in-flight-paid-writes-are-observable-through-a-dedicated-intent-status-surface.md)
  — the polling-over-push decision this extends to the operator audience
- [ADR-0050 — Durable writes follow the chain call, and an unbroadcast intent is retried before it is refunded](0050-durable-writes-follow-the-chain-call-and-unbroadcast-intents-are-retried-before-refund.md)
- [ADR-0051 — Replacement gas escalates geometrically under a configured cap](0051-replacement-gas-escalates-geometrically-under-a-configured-cap.md)
- `apps/backend/src/services/relayed-intent-registry.ts` — structured errors at completion and
  guard-release failure sites
- `apps/backend/src/services/relayed-intent-settlement.ts` — the sole refund decision path
- `apps/backend/src/lib/server-transaction-reconciler.ts` — replacement and settlement error logging
- `apps/backend/src/services/orphaned-payments.ts` and
  `apps/backend/src/scripts/retry-orphaned-refunds.ts` — the operator recovery tool this leaves as is

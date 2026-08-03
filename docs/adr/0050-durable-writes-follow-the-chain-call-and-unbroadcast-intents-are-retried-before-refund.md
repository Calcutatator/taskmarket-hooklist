# 0050 — Durable writes follow the chain call, and an unbroadcast intent is retried before it is refunded

> **Decision (Y-statement):** In the context of relayed writes recorded as durable intents, facing
> paths that still perform durable database work *before* their contract call and a settlement
> sweep that refunds any payment-carrying intent which never reached the chain, we decided that the
> ordering is always record intent → chain call → database writes in the completion handler, and
> that an intent provably never broadcast is rebroadcast verbatim — paid or unpaid — bounded by the
> relay receipt's own chain-enforced `validBefore` deadline, with refund reached only once retry is
> exhausted, to achieve a database that is never ahead of the chain and a payer who gets the thing
> they paid for rather than their money back, accepting that a payload whose deadline has passed
> simply fails and must be re-signed rather than being silently amended on the payer's behalf.

- **Status:** Accepted
- **Date:** 2026-08-03
- **Embodiment:** Verified
- **Last audited:** 2026-08-03
- **Author:** Claude Code (drafted for review)
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** Amends ADR-0048
- **Pending Amends / Amended-by:** —

## Context

ADR-0045 established that a relayed write is a durable intent, and that only confirmed on-chain
evidence may settle it. ADR-0047 narrowed refunds to intents that carry a payment and made a
deterministic revert terminal. ADR-0048 put the orphaning decision in exactly one place. Together
they describe a system where the chain speaks first and the database follows.

Two things in the current implementation contradict that, in opposite directions.

### The database can still get ahead of the chain

`wallet.withdrawDreams` claims a DREAMS withdrawal nonce — an atomic
`insert ... onConflictDoNothing` into `dreams_withdraw_nonces`, which is a real, permanent,
durable state change — and *then* calls `contractWithdrawDreamsRewards`. If that call never lands,
the nonce is spent for a withdrawal that never happened. The user's signed authorization is now
permanently unusable and there is no path back: the replay guard cannot distinguish "already
withdrawn" from "claimed for a withdrawal that evaporated", because that is exactly what it was
built not to distinguish.

An earlier analysis of which paths needed intents concluded that paths like this one were exempt,
on the grounds that *"all the database work happens before the chain call, so no divergence between
the database and the chain is possible."* **That reasoning is wrong, and it is worth recording as
wrong, because it is a plausible-sounding sentence that will be produced again.** It does not
describe an absence of divergence. It describes divergence in the other direction: the database
ahead of the chain rather than behind it. A row asserting something the chain never agreed to is
the same class of defect as a chain fact with no row — the one ADR-0045 exists to fix — and it is
in some ways worse, because a missing row can be backfilled from chain events while an invented one
cannot be identified as invented by looking at the chain at all.

The criterion that produced this mistake was **"is this path payer-gated?"**. That criterion is
wrong because it only ever sees half of what an intent is for. **An intent does two jobs:**

1. it makes a payment refundable on a confirmed on-chain failure, and
2. it makes the completion work outlive the request that started it.

Only the first is payment-specific. The second applies to every relayed write, free or paid, and it
is the one that decides where durable state changes may be written. `relayed-intent-request.ts`
already says this in a comment. It was not applied as a rule, so paths that needed only the second
job were classified as needing neither.

### The chain-side retry policy is backwards

`relayed-intent-worker.ts` rebroadcasts intents stuck in `recorded` — but only those with
`paymentTxHash IS NULL`. `settleAbandonedIntents` in `relayed-intent-settlement.ts` handles the
other half: after a 15-minute cutoff it marks a payment-carrying `recorded` intent failed and
refunds the payer.

So the intent we *can* most cheaply finish — the one where the requester has already paid, the
payload is durable on the row, and nothing is on chain to conflict with — is the one we give up on,
while the free one gets retried. That is exactly inverted. A requester who paid for a task wants the
task. Refunding them is a consolation prize for a job we could still do, and one that costs the
platform a refund transfer's gas to deliver.

**The evidence that makes retry safe here is unusually strong, and is worth stating precisely
because ADR-0047 reasoned the opposite way about a superficially similar situation.** ADR-0047
declined to infer anything from a transaction's absence, because a transaction missing from a
mempool may simply be one you cannot see — absence there is not evidence. This case is different in
kind. ADR-0040's dispatcher writes the `server_wallet_transactions` outbox row *at nonce
allocation*, before any broadcast is attempted. So an intent in `recorded` with
`server_wallet_transaction_id IS NULL` **and** `tx_hash IS NULL` has provably never had a nonce
allocated for it, which means nothing was ever signed, which means nothing can be in any mempool
anywhere. This is a positive fact recorded by our own code in our own database, not an inference
from something we failed to observe. `settleAbandonedIntents` already relies on exactly this
evidence to justify refunding — the same evidence justifies rebroadcasting, and rebroadcasting is
the better use of it.

### `settleAbandonedIntents` was never itself decided

It has no ADR. It appeared while wiring the paid paths through `runRelayedIntent`, because removing
the routers' inline `catch` blocks (ADR-0048) would otherwise have silently dropped refunds for
calls that never reached the chain — the one gap ADR-0048's confirmed-failure-only rule genuinely
leaves, since the reconciler can only speak for transactions that exist. Filling that gap was
right. Filling it with an unconditional refund was a default nobody chose out loud. This ADR is
where that path gets recorded, and where its behaviour changes from *refund* to *retry, then
refund*.

## Considered options

The question is twofold: **where durable writes may happen relative to the chain call**, and **what
happens to an intent that provably never reached the chain**.

| Option | Pros | Cons |
| --- | --- | --- |
| Ordering is always record intent → chain call → completion-handler writes, for every relayed path regardless of payment; an unbroadcast intent is rebroadcast verbatim, paid or unpaid, bounded by the receipt's `validBefore`, with refund only once retry is exhausted (selected) | One ordering rule with no exemption class, so "does this need an intent" stops being a judgement call and the wrong criterion cannot be reapplied; the database can never assert what the chain has not confirmed; the payer usually gets the thing they paid for rather than a refund; retry and refund read the same evidence, so there is one classification of "never broadcast" instead of two; the retry window is enforced by the contract rather than by a tuned constant; refund survives as the fallback, so no payer is left both unpaid-out and unrefunded | The payer must re-sign when a receipt expires, rather than the system quietly extending it for them; paths that today write before the chain call must be restructured, which is real work in `wallet.withdrawDreams` and anything shaped like it |
| Refund a payment-carrying unbroadcast intent on the cutoff, no retry (status quo, rejected) | Already built and running; terminal in bounded time; no stale-payload question ever arises; the payer is made whole with no further chain risk | Returns money instead of delivering a purchasable, still-deliverable outcome; costs a refund transfer's gas to deliver a worse result than doing the work; treats the strongest possible evidence that nothing happened as a reason to stop rather than a reason it is safe to continue; leaves the free/paid asymmetry where the paid path — the one with a paying customer waiting — is the one that gives up |
| Retry unpaid intents only (status quo, rejected) | Provably safe today and shipped; retrying a payment-less intent risks no money | The split is drawn on the wrong axis. Whether an intent carries a payment determines whether *refund* is available as a fallback; it says nothing about whether *rebroadcast* is safe. The safety of rebroadcast depends entirely on whether the transaction reached the chain, which is a question the outbox row already answers identically for both |
| Retry every unbroadcast intent, unbounded (rejected) | Simplest policy; no bound to define; eventually completes anything transiently blocked | This is precisely the defect ADR-0047 recorded: 4 of 4 evaluator-assignment intents sat at `recorded` carrying `TaskNotOpen`, re-asked on every pass forever. An intent that never reaches a terminal state is invisible to every alert that watches terminal states, and a deterministic failure re-asked on a timer is a question whose answer cannot change. For a payment-carrying intent it is strictly worse than the unpaid case it already broke: the payer is neither served nor refunded, indefinitely, and nothing reports it. The bound is what makes retry a policy rather than a loop |
| Retry past the receipt deadline by recomputing `validBefore` (and other time-derived payload fields) at each rebroadcast (rejected) | Retry would never be cut short by an expiring receipt; a transient RPC outage lasting longer than the window would still resolve; the payer's evident intent — "I wanted a 7-day task" — is honoured rather than their literal timestamp | Mutates what the payer authorised. The receipt is a signed statement with a deadline in it, and re-dating it substitutes our judgement for their approval — the same thing no wallet does: MetaMask lets a stale transaction die and asks the user to re-sign rather than silently amending it. It also destroys the property that makes retry safe to reason about at all: if the payload can change between attempts, "the same intent" is no longer the same call, and the chain's own expiry check stops being an authoritative bound |
| Give the payer the choice — surface the stuck intent and let them ask for retry or refund (rejected for now) | Most honest; no policy needs to guess what the payer prefers; ADR-0049's intent-status surface is the natural place to expose it | Requires a decision from someone who may never poll, so the common outcome is an intent stuck indefinitely awaiting an answer that never comes — reintroducing the unbounded case through the front door. Worth revisiting as an *addition* once automatic retry has a terminal outcome to fall back on, not as a replacement for having a default |

## Decision

**1. Durable state changes belong after the chain call is confirmed, without exception.** The
ordering for every relayed write is:

```
record intent  →  chain call  →  confirmed receipt  →  database writes (in the completion handler)
```

No relayed path may write **outcome state** before its contract call is **confirmed on chain** — a
row asserting that something happened. "Confirmed" here means a receipt whose status the completion
handler has actually observed; it is not RPC acceptance, not a transaction hash coming back from
submission, and not the absence of an error. A hash names a transaction that may still revert or
never mine, so nothing about it licenses an outcome write. Reads, validation, signature
verification, authorization checks and pre-flight simulation all happen before; they assert nothing
and leave nothing behind.

**There is one exception, and it is a real one: a write whose purpose is to prevent a concurrent
duplicate must precede the call.** A guard acquired after the critical section is not a guard. The
distinction is what the row means:

- **Outcome state** records that something happened. It belongs after confirmation, because before
  it the claim is not yet true.
- **Guard state** reserves the right to attempt something, so that two concurrent requests cannot
  both attempt it. It belongs before, because after the call the race it exists to prevent has
  already run.

`orphaned_payments`' atomic claim in `attemptRefund` and `dreams_withdraw_nonces` are both guard
state, and both are correct where they are. **A guard must, however, be released on confirmed
failure** — otherwise it permanently consumes something the user can never retry, which is the
defect described below.

So the ordering rule is: **"the chain has not spoken yet" is a reason to assert nothing, in either
direction — but it is not a reason to leave a race unguarded.**

**2. "Is this path payer-gated?" is not the criterion for whether a path needs an intent.** An
intent does two jobs — making a payment refundable, and making completion outlive the request — and
only the first is payment-specific. Any path that dispatches a contract call and has durable work
to do around it needs an intent, free or paid. A free path simply carries no payment reference and
has nothing to refund.

**3. `wallet.withdrawDreams` keeps its nonce claim where it is, and gains a release.** An earlier
draft of this ADR said the claim should move into the completion handler. **That would have been a
critical vulnerability, and the reasoning is worth recording so it is not repeated.**

`withdrawFor` is executed by the trusted backend wallet, not by a user transaction, so replay
protection cannot live on chain — `dreams_withdraw_nonces` is the only replay guard that exists.
Move the claim after the chain call and a captured signature can be replayed concurrently: every
copy passes signature verification, because it is the same genuinely valid signature, and every
copy reaches the chain call before any completion handler claims the nonce. N copies, N
withdrawals. The claim is a mutex, and a mutex acquired after the critical section is not a mutex.

The actual defect is not *when* the nonce is claimed but that **nothing ever releases it**. A chain
call that never lands leaves the authorization permanently unusable, and the guard cannot
distinguish "already withdrawn" from "claimed for a withdrawal that evaporated" — not
distinguishing those is precisely what it was built to do.

So: the claim stays before the call, exactly as written, atomic `onConflictDoNothing` preserved.
Settlement releases it when the intent reaches `failed` on confirmed evidence, or exhausts retry.
Release is settlement-driven, which means it can only follow confirmed failure and never a timeout
— the same rule that governs refunds, applied to a guard.

**4. An intent that provably never reached the chain is rebroadcast, paid or unpaid.** The
condition is `status = 'recorded'` with `server_wallet_transaction_id IS NULL` and
`tx_hash IS NULL`, past the orphan grace window. Because ADR-0040's dispatcher writes the outbox
row at nonce allocation, this is positive evidence that nothing was ever signed — not an inference
from an unobserved absence. The `paymentTxHash IS NULL` filter in `relayed-intent-worker.ts` is
removed. One condition, one classification, one code path for both.

**5. Retry is bounded by the receipt's own `validBefore` deadline, which the contract enforces.**
Unbounded retry is the defect ADR-0047 recorded, and this ADR does not reintroduce it — but the
bound is not a constant anyone tunes. Every relayed call already carries
`validBefore = now + RELAY_VALID_WINDOW_SECS` (300s today), and `TaskMarketForwarder.relay` reverts
`ReceiptExpired` once `block.timestamp > validBefore`. Past that point the payload cannot succeed,
whatever we do with it, and — since point 7 forbids re-dating it — that is the end of retry for that
intent.

**This is the same distinction ADR-0047 drew, applied to time instead of to transactions.** ADR-0047
could not use "absent from the mempool" because absence there is an inference about something we
failed to observe, and could use "a replacement mined at the same nonce" because that is chain
evidence. An expired receipt is chain evidence in exactly that sense: the deadline is a term of the
signed receipt and the forwarder checks it, so "this can no longer land" is a fact the contract
states, not a conclusion we reached by giving up. A retry policy whose terminal condition is
enforced on chain cannot drift out of step with what the chain will actually accept.

A **modest attempt cap remains, as belt and braces, not as the governing rule.** Its only job is to
stop a fast-failing error hot-looping the worker inside the window — burning passes and log volume
on a call that will fail identically each time. It bounds resource use, not correctness; correctness
is the deadline's job. Whatever value it takes is an operational constant of the same kind as
`INTENT_ORPHAN_GRACE_MS`, tunable from evidence without an ADR. Replacing the deadline as the
governing bound would require one.

A deterministic revert never reaches either limit — ADR-0047's classification already terminates it
immediately. Retry exists for the transient and the unclassifiable, which ADR-0047 deliberately
biases towards retrying; the deadline is what stops that bias from running forever.

**6. Refund is the fallback, not the reflex.** Only on exhaustion does a payment-carrying intent
reach `settleAbandonedIntents`'s existing behaviour: marked failed, `handlePostPaymentFailure`,
`orphaned_payments`. Everything ADR-0048 decided about that path is unchanged — one decision site,
the retained ledger, the preserved atomic claim in `attemptRefund`, the operator retry tool. This
ADR amends ADR-0048 only in *when* that path is reached. An exhausted intent with no payment is
marked failed with its reason and refunds nothing, as ADR-0047 requires.

**7. Everything about a relayed write is immutable except gas.**

> **Immutable:** the nonce, the calldata, `validBefore`, the receipt nonce, and the user-signed
> x402 authorisation.
> **Mutable:** `maxFeePerGas` and `maxPriorityFeePerGas`, escalated per attempt.
> **Nothing else.**

This is exactly a wallet's "speed up": same nonce, same destination, same data, higher fee. It is
the standard model, and stating it in those terms is the point — it makes the rule self-evident
rather than a local convention someone can later argue their way around. The x402 authorisation is
the clearest case: it is signed by the payer and settled before we relay, so we could not alter it
even if we wanted to. Every other field is immutable for the same reason, just less obviously
enforced.

So a payload is replayed verbatim, and nothing is ever recomputed on a rebroadcast. Some payloads
carry values fixed at request time: a `validBefore` deadline, an `expiryTime` derived from
`now + duration`, a quoted price. A rebroadcast replays every one of them exactly as recorded. If a
deadline has passed, the call fails and the payer submits again.

**The reason is signature semantics, and it generalises well beyond this case: you do not mutate
what a user authorised.** What they signed is what goes on chain. Quietly re-dating a deadline or
re-quoting a price on the payer's behalf substitutes our judgement for their approval, and does so
invisibly — the payer has no way to know the call that landed is not the call they signed. This is
the standard wallet model, and it is standard because it is right: MetaMask does not silently amend
a stale transaction, it lets it die and asks the user to re-sign.

The corollary matters as much as the rule: **a payload that would be actively wrong on replay is a
signal that the payload is carrying something it should not, not a licence to mutate it.** If
replaying a field verbatim produces a result nobody wants, the fix is in what the payload records
and how it is authorised — not in a retry path that quietly edits it. Verbatim replay is also what
makes retry tractable to reason about at all: the intent that is rebroadcast is byte-for-byte the
intent that was recorded, so "did this land?" has one answer and one call it refers to.

**`validBefore` is a genuine bound precisely because it is immutable.** This is worth stating
directly, because the alternative is seductive and self-defeating: recomputing `validBefore` on each
rebroadcast would hand every attempt a fresh 300-second window, and the deadline would never arrive.
That is unbounded retry wearing a deadline as a disguise — it would look like a bounded policy in
the code and behave like ADR-0047's infinite loop in production. The bound works only because the
value is fixed at submission and reused verbatim, which is to say: immutability is not a side
constraint on the retry policy, it is what makes the retry policy a policy.

Where an expiry means the work is genuinely no longer the work that was paid for, the intent falls
to refund under point 6. That is the correct use of refund.

## Consequences

**Positive:**

- The database can no longer assert something the chain never confirmed, in either direction. One
  ordering rule replaces a per-path judgement call whose criterion was wrong.
- A requester who paid usually gets the task instead of their money, which is what they wanted, and
  the platform spends a broadcast rather than a refund transfer to deliver it.
- Retry and refund are decided from the same evidence — the outbox row's absence — so there is one
  notion of "never broadcast" rather than two that can drift apart.
- The free/paid asymmetry disappears, and with it the surprise that the path with a paying customer
  was the one that gave up first.
- Every intent still reaches a terminal state in bounded time, so alerting that watches terminal
  states still sees everything — and the bound is enforced by the contract rather than by a constant
  that could be raised until it stopped bounding anything.
- The retry model is one a reader already knows: same nonce, same data, higher gas. There is no new
  policy to learn, and gas becomes the single configurable surface rather than one of several.
- `settleAbandonedIntents` acquires a written decision record and a defined trigger, instead of
  being a behaviour that exists because removing something else would have left a gap.

**Negative / trade-offs:**

- A payer waits longer for the bad outcome. Under the status quo an unbroadcast paid intent
  refunds at the cutoff; now it retries first, so worst-case time-to-refund grows by the retry
  window. This is the price of usually not needing the refund at all, and `validBefore` is what
  keeps it from growing without limit — a bound the payer signed, not one we chose.
- A payer whose receipt expires must re-sign and resubmit rather than having the system carry the
  request forward for them. That is a worse moment for them than a silent extension would be, and it
  is the correct trade: the alternative is landing a call they did not authorise.
- The retry window is now effectively `RELAY_VALID_WINDOW_SECS` (300s today), which is much shorter
  than the 15-minute abandonment cutoff. A transient RPC outage outlasting five minutes still ends in
  a refund, and lengthening that window means changing what payers sign, not tuning a retry constant.
- Releasing a guard on failure is itself security-relevant. The release must be reachable only from
  confirmed failure; a release triggered by a timeout would reopen the replay window on an
  authorization whose transaction may still land.
- Retry is only safe while the "never broadcast" condition is genuinely exhaustive. If any future
  code path can broadcast without first writing an outbox row, this decision silently becomes a
  double-spend. That invariant is now load-bearing in a way it was not before — and it is already
  enforced: `test/unit/config/server-wallet-transaction-usage.test.ts` fails the build if any
  `writeContract`, `sendTransaction`, `sendRawTransaction` or `deployContract` appears outside
  `dispatchServerWalletTransaction`, which writes the outbox row at nonce allocation. That test was
  written for ADR-0040 to prevent nonce collisions; it now also protects this decision, and anyone
  widening its allowlist needs to know what else they would be unlocking.

**Neutral / follow-up:**

- **Named follow-up requiring its own ADR: how gas is escalated across attempts.** Point 7 makes gas
  the *only* mutable field of a relayed write, which is precisely why it is the only thing that needs
  configuring — and why it deserves a decision of its own rather than a constant chosen in passing.
  The escalation curve, its cap, and its per-chain configuration through environment variables with
  defaults all belong there: Base and Ethereum mainnet behave very differently under congestion, so a
  single hardcoded curve cannot serve both. No curve and no number is specified here; this ADR
  establishes only that gas is the sole knob.
- The hot-loop guard's attempt counter needs somewhere to live. `relayed_intents` already carries
  `completion_attempts` for a different purpose; whether broadcast attempts get their own column or
  reuse a generalised one is an implementation detail, not a decision.
- Alerting on intents that exhaust their bound is not built, and matters more now than before: an
  exhausted intent is a payer who waited and then got refunded anyway, which is the outcome most
  worth knowing about. This is the same gap ADR-0047 and ADR-0048 both left open, and it is not
  closed here either.
- ADR-0049's intent-status surface is where a payer would see that an intent is still being
  rebroadcast and when its receipt expires. Exposing retry state there is a natural extension and is
  not decided here.
- Letting the payer choose retry-or-refund on a stuck intent remains attractive and is rejected only
  as a *replacement* for a default. Once automatic retry has a terminal fallback, offering the
  choice as an override is additive and could be taken up later.
- Whether a structural test can enforce the ordering rule in point 1 — the way ADR-0048 asked the
  completion registry's structural test to assert that a paid route registers an intent — is worth
  investigating. A rule enforced only by review is a rule with a half-life.

## References

- [ADR-0045 — Relayed writes are durable intents, not request-scoped transactions](0045-relayed-writes-are-durable-intents-not-request-scoped-transactions.md)
- [ADR-0047 — Evaluator assignment is its own intent, and the chaining subsystem is withdrawn](0047-evaluator-assignment-is-its-own-intent-and-chaining-is-withdrawn.md)
- [ADR-0048 — Orphaning a payment is decided only by intent settlement; the ledger is retained](0048-orphaning-a-payment-is-decided-only-by-intent-settlement.md)
- [ADR-0049 — In-flight paid writes are observable through a dedicated intent-status surface, not `pendingActions`](0049-in-flight-paid-writes-are-observable-through-a-dedicated-intent-status-surface.md)
- [ADR-0040 — Server-wallet transactions use a durable nonce allocator and outbox](0040-server-wallet-transactions-use-a-database-coordinated-dispatcher.md)
- `apps/backend/src/services/relayed-intent-request.ts` — the shared ordering, and the comment
  stating the intent's two jobs
- `apps/backend/src/services/relayed-intent-worker.ts` — the `paymentTxHash IS NULL` filter this
  removes, and `INTENT_ORPHAN_GRACE_MS`
- `apps/backend/src/services/relayed-intent-settlement.ts` — `settleAbandonedIntents` and
  `ABANDONED_INTENT_CUTOFF_MS`
- `apps/backend/src/services/relayed-intents.ts` — `listAbandonedIntents`, and the intent row
  carrying `serverWalletTransactionId` and `txHash`
- `apps/backend/src/routers/wallet.router.ts` — `withdrawDreams`, which claims its nonce before the
  chain call
- `apps/backend/src/lib/server-transaction-dispatcher.ts` — writes the outbox row at nonce
  allocation, which is what makes the "never broadcast" condition positive evidence
- `packages/contracts/src/TaskMarketForwarder.sol` — `relay`'s
  `if (block.timestamp > validBefore) revert ReceiptExpired();`, the chain-enforced retry bound
- `apps/backend/src/services/contract.ts` — `RELAY_VALID_WINDOW_SECS`, and `ReceiptExpired` in the
  `KNOWN_ERRORS` vocabulary

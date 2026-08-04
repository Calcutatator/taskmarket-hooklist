# 0057 — A settled payment is one indivisible reference, published by the middleware that settled it

> **Decision (Y-statement):** In the context of a paid relayed write whose refund is decided
> only by intent settlement, facing a payment reference carried as three independently optional
> fields that 24 of 26 paid call sites filled in only partly, we decided that a settled payment
> is a single `IntentPaymentReference` -- payer, amount and transaction hash together or not at
> all -- constructed nowhere but `settledPaymentReference`, which reads back the amount the
> x402 middleware actually settled, to achieve a refundable amount that is equal to the billed
> amount by construction rather than by two copies of a pricing rule agreeing, accepting that
> handlers now depend on middleware-published `res.locals` for a fact they used to be able to
> derive themselves.

- **Status:** Proposed
- **Date:** 2026-08-04
- **Embodiment:** Verified
- **Last audited:** 2026-08-04
- **Author:** Claude Code (drafted for review)
- **Reviewers:** (none recorded)
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** —
- **Pending Amends / Amended-by:** Pending Amends ADR-0048

## Context

ADR-0048 made intent settlement the sole place a payment may be declared orphaned, and ADR-0050
made `settleAbandonedIntents` the path that reaches that decision for an intent which provably
never broadcast. Both rest on one assumption that was never checked: that a payment-carrying
intent can actually name the payment it carries.

It usually could not. A live sandbox run found **83 of 174 paid intents with
`payment_amount = NULL`, across 20 of 22 paid operations**. `settleAbandonedIntents` opened with

```ts
if (!intent.paymentTxHash || !intent.payer || !intent.paymentAmount) continue;
```

so every one of those rows was skipped: no refund, no `orphaned_payments` row, no log line. The
payer was neither served nor refunded, and nothing reported it. That is the exact outcome
ADR-0050 named as the worst case of unbounded retry -- "the payer is neither served nor
refunded, indefinitely, and nothing reports it" -- arrived at from the opposite direction.

The cause was shape, not carelessness. `RelayedIntentRequestInput` carried `payer?`,
`paymentTxHash?` and `paymentAmount?` as three independent optionals, so a paid path could
satisfy the type while recording two of the three. Only 2 of 26 call sites passed an amount.
Nothing anywhere rejected the other 24, because nothing could: each field was individually
valid.

**The null is older than this branch; the silence is not, and that is what makes it a defect
now rather than a latent one.** Before ADR-0048, a paid path that failed pre-broadcast was
refunded by its own router's `catch`, which knew the amount from the request it was still
inside. ADR-0048 deliberately deleted those catches and moved the decision to settlement, which
reads the amount off the row. A field nobody had to populate became a field everything depended
on, and the transition made no noise.

There is a second, quieter half. Two routes are not priced at the flat action fee:
`tasks.create` is charged the full reward, and `tasks.update` the flat fee plus any increase in
the reward. `tasks.update` was one of the two call sites that did pass an amount, and it did so
by calling `computeUpdatePaymentAmount(task.reward, input.reward)` -- correct only for as long
as it kept being handed exactly the `(currentReward, requestedReward)` pair the middleware's
`getUpdatePaymentAmount` had used. **A wrong amount is worse than a missing one.** A missing
amount strands a payment; a wrong one refunds the wrong sum out of pooled escrow, which is
somebody else's money, and it does so while looking entirely healthy.

## Considered options

The question is **what shape a payment reference has, and who is allowed to state the amount**.

| Option | Pros | Cons |
| --- | --- | --- |
| One `IntentPaymentReference` object -- payer, amount, hash together -- built only by `settledPaymentReference`, which reads the amount the middleware settled (selected) | The partial reference stops being expressible, so the defect cannot recur through inattention rather than being caught after the fact; the refundable amount is the billed amount by construction, with no second copy of a pricing rule to drift; the two variable-priced routes need no special handling at their call sites, which is where the special handling was most likely to rot; one reader of `res.locals` instead of twenty-six; a free path passes nothing and means it | Handlers now depend on middleware-published `res.locals`, which is untyped and easy to forget to populate in a test; a route that ever settles a payment outside `x402Middleware` would have to publish the same three values or record nothing |
| Keep three optional fields and pass the amount at all 26 call sites (rejected) | Smallest diff; no new type; each router states its own price, which reads as explicit | Fixes the 24 instances without fixing the shape that produced them -- the 27th call site is exactly as free to omit the amount as the first 24 were. It also multiplies the wrong-amount risk: every site restates a pricing rule the middleware owns, and the two sites where restating it is hardest are the two where getting it wrong costs the most |
| Make the three fields a discriminated union on a `paid: true` / `paid: false` tag (rejected) | Also unrepresentable; arguably the most explicit about which branch a call site is on | The tag carries no information the presence of the object does not. `payment?: IntentPaymentReference` already says "paid or not" and says it in one field; a discriminant adds a second thing to keep consistent with the first, and a call site that sets `paid: true` with an empty payment is a new way to be wrong |
| Validate at runtime in `recordRelayedIntent` -- throw if a hash arrives without an amount (rejected) | Catches the mistake wherever it originates, including from code the type cannot see | Turns a compile-time impossibility into a production exception on a paid path, after the payment has settled. The caller has already been charged by the time this fires, so the safest available behaviour is the one that strands the payment it was meant to protect. Worth having as a backstop, not as the mechanism |
| Have settlement fall back to the flat action fee when the amount is missing (rejected) | No call sites change; every intent becomes refundable immediately | Refunds a guessed amount from pooled escrow. It would be wrong by construction for `tasks.create` (priced at the reward, frequently thousands of times the flat fee) and for any `tasks.update` that raised a reward, and being wrong in the payer's favour is still taking the difference from other payers' escrow. A refund nobody can reconcile is worse than a stranded payment somebody can |

## Decision

**1. A settled payment is one value.** `IntentPaymentReference` is `{ amount, payer, txHash }`,
all required. `RelayedIntentRequestInput` and `RecordIntentInput` take `payment?:
IntentPaymentReference`; the separate `paymentTxHash` and `paymentAmount` inputs are gone. An
intent either carries a payment it can name in full or carries none. `payer` remains as a
separate optional field for provenance on free paths, and where both are present the payment's
payer wins, because that is the address the facilitator confirmed.

**2. The amount is the one the middleware settled, read back rather than re-derived.**
`settledPaymentReference(res)` in `middleware/x402.ts` is the only supported constructor. The
middleware publishes `res.locals.paymentAmount` alongside `payer` and `paymentTxHash` at the
moment settlement succeeds, using the same `expectedAmount` it checked the authorization
against. No handler restates a price. `tasks.update` no longer calls
`computeUpdatePaymentAmount` for this purpose, and `tasks.create` no longer reconstructs the
reward: both are variable-priced, and both are now refundable at exactly what was charged
without either knowing why.

**3. Nothing but the middleware reads a settled payment out of `res.locals`.** `res.locals` is
untyped, which is how two thirds of a reference gets reconstructed by hand and believed. One
reader means one place that can get the all-or-nothing rule wrong, and it is the place that
wrote the values.

**4. An incomplete payment reference on a stored row is reported, never skipped.** Both
settlement paths now distinguish two cases that were previously collapsed:

- **No payment at all** (`paymentTxHash` and `paymentAmount` both absent) -- a free relayed
  write. Expected; nothing is owed. Note that `payer` alone does not mean paid: every intent
  records one.
- **Part of a payment** -- money moved and we cannot say how much. Logged at `error` with the
  intent id and operation, because it is a payer out of pocket with no ledger row to find them
  by. ADR-0053 makes structured logs the entire reporting surface here; there is no alerting,
  so the one thing this must not do is stay quiet.

**5. The structural guard is over the call sites, not over the symptom.**
`test/unit/config/intent-payment-reference-usage.test.ts` fails the build if the input type
regains a split field, if any `runRelayedIntent` call passes one, if a payment is assembled as
an object literal at a call site, or if anything outside the middleware reads
`res.locals.paymentTxHash`/`paymentAmount`. It follows the shape of the existing AST guards
alongside it, and it fails on the pre-fix tree at 19 call sites.

**6. No migration, and none is needed.** Migration `0042` is unshipped and there is no
production data, so no partially-populated row exists to repair. Nor would a backfill be
possible if one did: the missing field is the amount, and nothing on the row records what was
charged -- recovering it would mean reading the settled x402 transfer back off chain, which is
a recovery procedure rather than a migration. What point 4 gives such a row instead is
visibility: it is named in the logs with its intent id and operation, from which an operator can
find the payment on chain and drive a refund through the existing `orphaned_payments` retry
tool. That is the right trade for a case that should now be unreachable.

## Consequences

**Positive:**

- The defect is unrepresentable rather than fixed. A 27th paid call site cannot record an
  unrefundable payment, because there is no way to express one.
- The refundable amount equals the billed amount by construction. The two variable-priced
  routes stop being the two places a pricing rule is duplicated.
- Paid submissions past the free allowance (RFC-0006 Tier 1) now record a payment reference at
  all. They previously recorded none, so a submission that never reached the chain was
  unrefundable for a different reason nobody had noticed.
- Settlement's `continue` is no longer silent, so the class of bug this ADR fixes would now
  announce itself rather than being found by counting rows in a sandbox run.
- One reader of `res.locals` for payment facts, down from twenty-six.

**Negative / trade-offs:**

- Handlers depend on middleware-published `res.locals`, which TypeScript does not check. A test
  that fakes a paid request must set all three values or it gets no payment -- several existing
  tests had to be updated for exactly this, which is the failure mode showing up early rather
  than being absent.
- A future paid route that settles a payment by some route other than `x402Middleware` must
  publish the same three values or record no payment. It cannot record half of one, which is
  the intended outcome, but it does mean the middleware is now load-bearing for correctness and
  not just for charging.
- `payer` and `payment.payer` can both be present, and the precedence rule between them is a
  convention rather than something the type enforces. They are the same value on every path
  today.

**Neutral / follow-up:**

- Alerting on the new `error` logs is still not built, and is the same gap ADR-0047, ADR-0048
  and ADR-0050 each left open. A loud log with nothing listening is better than silence and
  worse than an alert.
- Whether `x402Options.getAmount` should return the amount to the handler directly, rather than
  through `res.locals`, is an ergonomic question this leaves alone. The untyped hop is the one
  unsatisfying part of the chosen shape.
- Nothing here changes when a refund is decided or by whom. ADR-0048 and ADR-0050 stand exactly
  as written; this ADR only makes the fact they operate on actually present, which is why it
  claims an amendment relationship rather than a supersession.

## References

- [ADR-0045 — Relayed writes are durable intents, not request-scoped transactions](0045-relayed-writes-are-durable-intents-not-request-scoped-transactions.md)
- [ADR-0048 — Orphaning a payment is decided only by intent settlement; the ledger is retained](0048-orphaning-a-payment-is-decided-only-by-intent-settlement.md)
- [ADR-0050 — Durable writes follow the chain call, and an unbroadcast intent is retried before it is refunded](0050-durable-writes-follow-the-chain-call-and-unbroadcast-intents-are-retried-before-refund.md)
- [ADR-0053 — Relayed-write observability is by query, not by alerting](0053-relayed-write-observability-is-by-query-not-by-alerting.md)
- `apps/backend/src/middleware/x402.ts` — publishes the settled amount and owns
  `settledPaymentReference`, the only constructor
- `apps/backend/src/services/relayed-intents.ts` — `IntentPaymentReference` and
  `recordRelayedIntent`
- `apps/backend/src/services/relayed-intent-request.ts` — `RelayedIntentRequestInput`
- `apps/backend/src/services/relayed-intent-settlement.ts` — the two paths that now report an
  incomplete reference instead of skipping it
- `apps/backend/src/services/task-payments.ts` — `getUpdatePaymentAmount` and
  `computeUpdatePaymentAmount`, now used only by the middleware
- `apps/backend/test/unit/config/intent-payment-reference-usage.test.ts` — the structural guard
- `apps/backend/test/unit/services/relayed-intent-abandoned.test.ts` — refund and loud-log
  coverage
- Issue #439 — the sandbox run that found 83 of 174 paid intents with a null amount

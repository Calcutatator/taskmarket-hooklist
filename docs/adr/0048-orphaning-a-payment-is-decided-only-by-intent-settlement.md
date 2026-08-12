# 0048 — Orphaning a payment is decided only by intent settlement; the ledger is retained

> **Decision (Y-statement):** In the context of a paid write, where an x402 payment we observe is
> followed by a contract call we dispatch, facing a "this payment is orphaned, refund it"
> judgement currently made inline in each paid router's `catch` block on any error at all, we
> decided that this judgement is made in exactly one place — a payment-carrying intent whose
> transaction confirmed-failed, settled by `relayed-intent-settlement.ts` — while
> `orphaned_payments` is retained unchanged as the ledger and operational surface that path
> writes to, to achieve one decision made on evidence that actually supports it instead of many
> made on evidence that does not, accepting that the two-transaction reality of a paid write is
> still not atomic and a compensating refund is still what covers it.

- **Status:** Accepted
- **Date:** 2026-08-03
- **Accepted:** 2026-08-03
- **Embodiment:** Verified
- **Last audited:** 2026-08-03
- **Author:** Claude Code (drafted for review)
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** Amended by ADR-0050; amended by ADR-0057
- **Pending Amends / Amended-by:** —

## Context

A paid write in this system is two on-chain transactions, and always has been. The first is an
x402 payment we **observe** — the external facilitator broadcasts it, we learn its hash from the
middleware. The second is the forwarded contract call we **dispatch** through the server wallet.
They cannot be made atomic. When the first lands and the second does not, someone owes the payer
their money back.

`services/orphaned-payments.ts` and the `orphaned_payments` table (migrations 0038/0039) are the
compensation for exactly that. Two production incidents sit behind them — **2026-06-11** and
**2026-07-24** — where a settled payment produced no task and left no record anywhere that money
had moved. That mechanism was a reasonable response to a real problem, and this ADR does not
argue otherwise.

**What is wrong is not the ledger. It is the trigger.**

Today the judgement *"this payment is orphaned, refund it"* is made inline, in each X402-gated
router's `catch` block, via `handlePostPaymentFailure`. Three things follow from that placement:

- **It is made on evidence that does not support it.** Any error reaching that `catch` produces a
  refund. A receipt timeout is not a failed transaction — the transaction is broadcast, recorded
  in the outbox, and the reconciler will still see it mined or replace it. Refunding on a timeout
  pays the requester back for work that then lands on chain anyway, leaving the escrow funded from
  the server wallet. That is the defect ADR-0045 exists to fix, and it is a property of *where*
  the decision is made, not of what it writes.
- **It is duplicated.** Every paid router carries its own version of the same catch-and-compensate
  shape, so the rule is only as correct as its least careful copy.
- **It is made where the answer is not yet known.** The request is the one context guaranteed to
  be gone before the chain has spoken.

**ADR-0045 removed the reason for that placement.** A relayed intent records, on one row, both
halves of the pair: the payment reference (`payer`, `paymentTxHash`, `paymentAmount`) and the
dispatched transaction (`serverWalletTransactionId`, `txHash`). The reconciler already
distinguishes the three terminal outcomes — confirmed, reverted, replaced — and
`relayed-intent-settlement.ts` already resolves an intent from its verdict in both directions.
Previously the reconciler could not have decided a refund even if asked, because it settled nonces
without knowing what a transaction was *for*, which is precisely why the association had to live
in a side table with its own inline triggers. That is no longer true.

So *"the payment landed, the contract call is confirmed-failed, refund"* is now a single intent
settling normally: one row that already holds both facts, one decision, made on confirmed on-chain
evidence.

**This is notably not the chaining subsystem ADR-0047 withdrew, and nothing here rebuilds it.**
ADR-0047 named modelling the x402 payment as the root of a chain as the case that "would genuinely
justify chaining if it is ever rebuilt." On closer inspection it does not. Chaining existed to
make one intent *cause* a second intent's transaction to be dispatched — parent links, depth
bounds, cycle detection, root resolution. The payment is not a second dispatched transaction. It
is a fact recorded on the intent before the intent's only contract call is broadcast, observed
rather than sent, terminal before the intent begins. There is no second record to link to, no
ordering to enforce, and no root to resolve: the intent *is* the root, and it already holds the
payment. ADR-0047's withdrawal stands in full.

**Much of this is already implemented on this branch.** `relayed-intent-settlement.ts`'s
`onFailed` already resolves the intent, marks it failed, and calls `handlePostPaymentFailure`;
`handlePostPaymentFailure` already rethrows `ServerTransactionPendingError` untouched rather than
refunding on a pending outcome. What this ADR records is therefore the principle and what it
rules out, not a large new build. It is written because the principle is the part that will get
re-litigated — the next paid endpoint's author has to know not to add a `catch` — and because a
convention with no written decision behind it survives exactly as long as the people who
remember it.

## Considered options

The question is **where the orphaning decision is made**, not what records it.

| Option | Pros | Cons |
| --- | --- | --- |
| The decision is made only by intent settlement, from a confirmed-failed payment-carrying intent; `orphaned_payments` is retained as the ledger and ops surface it writes to (selected) | One decision path instead of one per paid router, so the correctness of the rule does not depend on the least careful copy; the decision is made where both the payment reference and the on-chain verdict already sit, on evidence that supports it; a timeout can no longer reach it; the ledger, the retry script and the atomic claim all keep working exactly as they do today, so the audit trail and the recovery tool are untouched | A paid write is still two transactions and still compensated rather than atomic; a new paid endpoint can still reintroduce an inline `catch` unless something stops it; the intent layer now owns a money decision, so its correctness matters more than it did |
| Keep the decision inline in each paid router's `catch` (status quo, rejected) | No change; the request can tell the payer immediately what happened and whether a refund went through | Refunds on evidence that does not support the conclusion — a receipt timeout is not a failure, and the resulting double spend is a live defect, not a hypothetical one. The rule is duplicated across every X402-gated router, so it is only as correct as its least careful copy, and each new paid endpoint is a fresh chance to get it wrong. It also decides in the one context guaranteed to be gone before the chain has spoken |
| Both: settlement decides, and routers keep their inline `catch` as a safety net (rejected) | Feels defensive; a bug in the intent layer would not leave a payer unrefunded; nothing has to be removed | Two mechanisms that can disagree about one payment, and the disagreement is the dangerous direction: the router concludes failure on a timeout while settlement later concludes success from the receipt. The unique `payment_tx_hash` constraint would stop a literal second ledger row, but only by leaving a refunded payer holding a task the chain also gave them. A safety net that fires on evidence known to be wrong is not a safety net |
| Move the decision into settlement but also give `relayed_intents` its own refund columns, duplicating the ledger (rejected) | Everything about one paid write on one row; no join to answer "was this payer refunded?" | Two records of one refund, which is strictly more dangerous than one: they can disagree, and the failure it invites is a refund counted once in each and sent twice — the exact double payout the atomic claim exists to prevent, reintroduced by the change meant to tidy up. It also requires reimplementing that claim rather than inheriting it, which is where a deliberately fixed bug comes back |
| Retire `orphaned_payments` entirely once settlement owns the decision (rejected) | Fewer tables; one less thing to operate | Strands any live non-terminal row — real payers, real USDC — and destroys the ledger of the 2026-06-11 and 2026-07-24 incidents, which is the evidence anyone would want during the next one. The record is valuable in its own right, independently of what triggers a write to it: money moved for something that did not happen, and that is worth keeping whoever decided it |

## Decision

**1. Intent settlement is the sole decision path for orphaning a payment.** A payment is declared
orphaned in exactly one place: `relayed-intent-settlement.ts`'s `onFailed`, reached only from the
reconciler's verdict, for an intent that carries a payment reference and whose transaction is
confirmed-failed — a reverted receipt or a confirmed replacement. No router, handler or request
path may make that judgement. This restates ADR-0045's rule as a placement rule: only confirmed
on-chain evidence may settle, and the only code that sees such evidence is settlement.

**2. What this rules out is the inline `catch`.** New and existing X402-gated mutations do not
wrap their relayed call in a catch that compensates. A failure surfaces as an intent the
reconciler will settle; the request reports progress and carries no settlement meaning. Since a
paid path is only correct if it records an intent before consuming the payment, the existing
structural test over the completion registry — the one ADR-0045 asked for so a new operation kind
cannot ship without a handler — is the right place to also assert that a paid route registers an
intent, rather than relying on reviewers to notice a reintroduced `catch`.

**3. `orphaned_payments` is retained, unchanged, as the ledger that path writes to.** The table,
its status machine (`pending → refunding → refunded | failed`), `recordAndRefundOrphanedPayment`
and the refund transfer all stay exactly as they are. Settlement calls the same
`handlePostPaymentFailure` that exists today. The record is valuable in its own right and
independently of its trigger: it is the audit trail of money that moved for something that did not
happen, and two incidents' worth of history lives in it. **Nothing is deleted.**

**4. The atomic claim in `attemptRefund` is preserved exactly, and must be.** The single
conditional UPDATE moving a row from `pending | failed` to `refunding` *before* any transfer is
sent is the only thing preventing a double payout under concurrent retries — an ops run
overlapping a cron, two ops runs at once. Postgres serializes concurrent UPDATEs to one row, so
exactly one caller's UPDATE matches and proceeds to the chain; the other sees zero rows and backs
off. Because settlement reuses this code rather than reimplementing it, the guard is inherited
rather than rebuilt, and the bug it fixed cannot come back through this change. Any future
refactor that moves the refund elsewhere must carry this claim and its concurrency test with it.

**5. The operator retry affordance stays as it is.** `retryFailedOrphanedRefunds` and
`scripts/retry-orphaned-refunds.ts` remain the recovery tool: after fixing an external blocker, an
operator re-runs the sweep. **This is still needed, and settlement is the reason it is needed
rather than a reason it is not.** A refund transfer needs ETH for gas exactly like the action it
refunds, so the server wallet running dry fails settlement's own refund attempt precisely as it
failed the original action. The recovery is unchanged: top up the server wallet, re-run the sweep.
The one thing that changes is the caller that produced the `failed` row.

**6. Existing rows are unaffected.** Live `orphaned_payments` rows in `pending`, `refunding` or
`failed` keep working through the same code, resolved by the same sweep, with no migration,
backfill or drain. Nothing about the ledger's shape or lifecycle changes, so there is no window in
which a row is stranded, no two-deploy sequencing, and no ambiguity about which mechanism owns a
given row. This is the principal reason the change is low risk, and it is a direct consequence of
retaining the record rather than collapsing it.

**7. Nothing here rebuilds chaining.** No parent links, no depth bounds, no cycle detection, no
root resolution. The payment is an observed transaction already recorded on the intent, not a
second dispatched one.

## Consequences

**Positive:**

- The orphaning decision is made once, from evidence that supports it, instead of once per paid
  router from evidence that does not.
- A receipt timeout can no longer cause a refund, because the only code that can decide a refund
  never sees one.
- The decision is made where the payment reference and the on-chain verdict already sit together,
  so it needs no extra lookup and cannot guess whose payment it meant.
- A new paid endpoint inherits correct compensation by recording an intent, rather than by
  correctly copying another router's `catch`.
- The audit trail, the atomic claim and the operator recovery path are all unchanged, so the
  properties that were deliberately built and deliberately fixed are not re-derived.
- No migration, no drain, no dual-mechanism window. The change is a narrowing of who may decide.

**Negative / trade-offs:**

- A paid write remains two transactions compensated after the fact. This decision makes the
  compensation correctly triggered; it does not make it unnecessary.
- The payer no longer learns the refund outcome in the failing request, since the decision now
  happens after the request is gone. They learn it from the intent's state, which is a worse
  immediate experience than a synchronous error message that included the refund tx hash — and an
  honest one, because that message was previously sometimes wrong.
- The intent layer now owns a money decision. A bug there is a payment bug, where before it would
  have been a task-visibility bug.
- Discipline is required at each new paid endpoint. Without the registry-level assertion in
  point 2, an inline `catch` reintroduces the defect silently.

**Neutral / follow-up:**

- Alerting on rows left in `refund_status = 'failed'` is still not built. The retry script has
  always been run because a human noticed something, never because something told them. Worth its
  own change; it does not block this one.
- Notifying a payer when their refund is issued, rather than leaving them to infer it, is
  unchanged and out of scope.
- ADR-0047 named this as a follow-up "requiring its own ADR" and expected it might justify
  rebuilding chaining. This ADR is that follow-up, and finds that it does not, and that the
  `orphaned_payments` collapse it anticipated is not the right shape either: the ledger is worth
  keeping, only the trigger needed fixing. That narrows an expectation rather than reversing a
  decision, so no supersession or amendment relationship is claimed against ADR-0045 or
  ADR-0047; both stand exactly as written.
- Whether `handlePostPaymentFailure`'s always-throws contract still fits a settlement context with
  no caller to inform — settlement currently catches the throw and string-matches the message to
  decide whether to log — is an ergonomic wart, not a correctness issue, and is left alone here.

## References

- [ADR-0045 — Relayed writes are durable intents, not request-scoped transactions](0045-relayed-writes-are-durable-intents-not-request-scoped-transactions.md)
- [ADR-0047 — Evaluator assignment is its own intent, and the chaining subsystem is withdrawn](0047-evaluator-assignment-is-its-own-intent-and-chaining-is-withdrawn.md)
- [ADR-0040 — Server-wallet transactions use a durable nonce allocator and outbox](0040-server-wallet-transactions-use-a-database-coordinated-dispatcher.md)
- `apps/backend/src/services/relayed-intent-settlement.ts` — the sole decision path
- `apps/backend/src/services/orphaned-payments.ts` — the retained ledger, including the
  `attemptRefund` atomic claim and `retryFailedOrphanedRefunds`
- `apps/backend/src/scripts/retry-orphaned-refunds.ts` — the retained operator recovery tool
- `apps/backend/src/services/relayed-intents.ts` — the intent row carrying both the payment
  reference and the dispatched transaction
- `apps/backend/drizzle/migrations/0038_add_orphaned_payments.sql`,
  `0039_orphaned_payments_status_check.sql` — the ledger table and its status check
- createTask payment-orphan incidents, 2026-06-11 and 2026-07-24

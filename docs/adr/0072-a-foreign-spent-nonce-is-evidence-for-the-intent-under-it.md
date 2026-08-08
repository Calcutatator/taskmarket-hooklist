# 0072 — A foreign-spent nonce is evidence for the intent under it, not just for the outbox row

> **Decision (Y-statement):** In the context of a reconciler that ends an outbox row whose nonce
> was consumed by a transaction this backend never sent, facing the fact that the row was being
> settled while the relayed intent beneath it was left untouched — so a paid caller's write
> neither completed nor refunded — we decided that all three terminal branches of
> `settleNonceSpentElsewhere` settle the intent alongside the row, and that the foreign-spender
> branch counts as positive evidence the work did not happen and is therefore refundable, to
> achieve one rule for what ends an intent rather than one per code path, accepting that the
> refund is only sound while a single backend instance broadcasts for the wallet.

- **Status:** Accepted
- **Date:** 2026-08-07
- **Embodiment:** Not started
- **Last audited:** `[unaudited]`
- **Author:** Claude Code (drafted for review)
- **Deciders:** Beau Williams
- **Reviewers:** Beau Williams — self-attested; no independent reviewer recorded
- **Supersedes / Superseded-by:** —
- **Amends / Amended-by:** Amends ADR-0063; amends ADR-0069; amended by ADR-0073
- **Pending Amends / Amended-by:** —

## Context

ADR-0063 gave the reconciler `settleNonceSpentElsewhere`: a row whose nonce the chain reports as
consumed, while the row's own hash still has no receipt, is ended rather than replaced forever.
That decision was made against a backend where the outbox row *was* the whole unit of work. Ending
the row was ending the job.

ADR-0045 changed what a row is. A row now sits beneath a relayed intent, and an intent is what a
paying caller actually holds. Every other terminal branch in the reconciler settles both — the
reverted-receipt branch, the mined-replacement branch, the confirmed branch. `settleNonceSpentElsewhere`
was written before that pairing existed in this file and did not acquire it, because on `main` there
was no intent layer for it to acquire.

The two met for the first time when `main` merged into the settlement-layer branch. In the combined
file, three terminal branches set an outbox row and returned without touching the intent:

| Branch | Sets the row | Left the intent |
| ------ | ------------ | --------------- |
| receipt re-read says `success` | `confirmed` | never completed, so its handler never ran |
| receipt re-read says `reverted` | `failed` | never failed, so never refunded |
| nonce spent, no receipt for our hash | `failed` | never failed, so never refunded |

Each is a caller who paid, whose write is over, and who is told nothing. That is the exact failure
ADR-0045 exists to prevent, arriving through a branch written before ADR-0045 applied here.

The `success` and `reverted` branches are uncontroversial: they are the same evidence the reconciler
already acts on elsewhere, reached by a different route. The third branch is the decision.

## Considered options

| Option | Pros | Cons |
| ------ | ---- | ---- |
| **All three branches settle the intent; foreign-spend refunds** (chosen) | One rule for what ends an intent, applied wherever the evidence appears. The foreign-spend branch returns early unless `row.txHash` exists, so the transaction was broadcast and the chain says its nonce is gone — it can never mine, which is the positive evidence ADR-0045 requires. A caller gets their money back rather than nothing | The refund assumes the foreign transaction was not this intent's own work arriving by another route. True for one broadcasting instance; not guaranteed for several |
| Settle `success` and `reverted` only, leave foreign-spend non-terminal (rejected) | Strictly conservative: never refunds on an inference about who sent what | Reinstates the manual-reconciliation outcome ADR-0071 was written to remove, for a case where the chain has in fact answered. An operator would be reading the same two facts the code already has |
| Leave all three as they were and treat the outbox row as sufficient (rejected) | No change | The row is not what the caller holds. This is the defect, not a position |
| Refund only after a delay, in case the foreign transaction turns out to be ours (rejected) | Feels safer | A timer is not evidence — the rule ADR-0045 was written to establish. The nonce is already spent; waiting changes nothing about what the chain will say |

## Decision

All three terminal branches of `settleNonceSpentElsewhere` settle the intent beneath the row as
well as the row itself: `confirmed` completes it, `reverted` and the foreign-spender case fail it.

A foreign-spent nonce, **where the row carries a transaction hash**, is positive evidence that the
intent's work did not happen, and is therefore refundable. The guard matters: the function returns
early unless `row.txHash` is set, so this only ever applies to a transaction that was actually
broadcast and can now never mine.

This is deliberately *not* the case ADR-0069 leaves open. That one is guarded by `!row.txHash` — a
send that never returned an answer — where the transaction occupying the nonce may have been the
intent's own. There, refunding could pay for work that landed, so the intent stays non-terminal.
The distinction is the hash: with one, we know what we broadcast and that it is dead; without one,
we do not know what we broadcast at all.

## Consequences

**Positive:**

- An intent whose nonce was taken by a deploy or an operator script ends, in the direction the
  evidence supports, with no operator involved.
- The reconciler now has one rule — every terminal branch settles both layers — rather than a rule
  with an exception that depends on which decision introduced the branch.
- The `success` branch runs the completion handler, so work that did land is recorded rather than
  silently dropped.

**Negative / trade-offs:**

- **The refund is sound only while one backend instance broadcasts for the server wallet.** With
  several, a second instance could broadcast the same intent at the same nonce, producing a
  different hash; the first instance would read that as a foreign spend and refund work that
  actually landed. The deployment is single-instance today and this decision depends on it. Making
  the reconciler safe under multiple broadcasters is a separate problem, and this ADR should be
  revisited before that changes rather than after.
- One more path may now refund, so the set of refund triggers grows from four to five. That set is
  worth keeping small and enumerated; this is an addition to it, not an exception to it.

**Neutral / follow-up:**

- `getLatestNonceCount` becomes optional on the reconciler options, with absence treated exactly as
  a failed read: no evidence, so the check stands down and the ordinary replacement path runs. This
  is a testing affordance, not part of the decision — a caller that omits it loses recovery, never
  correctness.
- No schema change. Nothing about how evidence is gathered changes; only what is done with it once
  gathered.

## References

- `docs/adr/0063-the-reconciler-settles-a-nonce-spent-by-a-foreign-transaction.md` — introduced
  `settleNonceSpentElsewhere`, for a backend with no intent layer.
- `docs/adr/0069-the-outbox-row-is-the-intents-evidence-that-a-nonce-was-spent.md` — the no-hash
  case this decision deliberately does not touch.
- `docs/adr/0045-relayed-writes-are-durable-intents-not-request-scoped-transactions.md` — the
  standard of evidence a refund must meet.
- `docs/adr/0071-an-intent-asks-the-chain-whether-its-own-receipt-was-consumed.md` — the other half
  of removing manual reconciliation.
- `apps/backend/src/lib/server-transaction-reconciler.ts` — `settleNonceSpentElsewhere`.

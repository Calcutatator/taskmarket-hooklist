# 0073 — A terminal outbox row settles the intent beneath it, whoever wrote it

> **Decision (Y-statement):** In the context of relayed writes whose server-wallet transaction
> reaches a terminal on-chain verdict, facing a third instance of one failure shape — an outbox
> row advanced while the intent beneath it is left unsettled, so a payer is charged for work the
> chain refused — we decided that `confirmed` means the receipt arrived *and succeeded* in every
> writer (the dispatcher now records a reverted receipt as `failed`, as the reconciler always
> has), and that a `failed` outbox row carrying a transaction hash settles the intent beneath it
> from a single sweep rather than from each writer's own branch, to achieve one refund rule that
> a new terminal branch cannot bypass, accepting a second-long settlement latency for the
> in-request case and one more query per worker pass.

- **Status:** Accepted
- **Date:** 2026-08-08
- **Accepted:** 2026-08-08
- **Embodiment:** Verified
- **Last audited:** `[unaudited]`
- **Author:** Claude Code (drafted for review)
- **Deciders:** Beau Williams
- **Reviewers:** Beau Williams — self-attested; no independent reviewer recorded
- **Supersedes / Superseded-by:** —
- **Amends / Amended-by:** Amends ADR-0040; amends ADR-0045; amends ADR-0072
- **Pending Amends / Amended-by:** —

## Context

A paid write whose contract call reverts on chain was never settled and never refunded. The payer
was charged, the work did not happen, and the money stayed gone. It was reproduced twice in a
sandbox run — two payers, two operations (`bids.auctionAccept`, `tasks.refundExpired`), both with
`receipt.status = 0`. Twenty-nine minutes later both intents were still `recorded`,
`orphaned_payments` was empty, and `/api/health` reported `staleNonTerminal: 0`. Nothing anywhere
knew.

The mechanism, traced:

1. `server-transaction-dispatcher.ts` wrote `setStatus(id, 'confirmed', { hash })` regardless of
   the receipt's status. A reverted receipt still marked the outbox row `confirmed`.
2. `contract.ts` then threw, because `receipt.status !== 'success'`.
3. `relayed-intent-request.ts` caught a throw that was not a `ServerTransactionPendingError`, ran
   `onNotBroadcast()` and rethrew. **The intent's `txHash` was never persisted.**

The result is an outbox row `confirmed` with a hash and an intent `recorded` with a NULL hash, and
all three sweeps miss it, each for an individually defensible reason:

| Sweep | Requires | Actual |
| --- | --- | --- |
| `listStrandedIntents` | outbox `failed`, outbox hash NULL | outbox `confirmed`, with a hash |
| `settleAbandonedIntents` | no `serverWalletTransactionId` | linked |
| `listConfirmedUnsettledIntents` | inner join on `relayedIntents.txHash` | NULL, so it joins nothing |

The irony is the expensive part. ADR-0045 names a reverted receipt as *the* canonical confirmed
evidence that the work did not happen and the payment is refundable. This path held that evidence
in a local variable and threw it away.

### The shape, not the instance

This is the third time the same defect has been fixed:

- ADR-0072 — `settleNonceSpentElsewhere` ended an outbox row and left the intent alone.
- The same branch's siblings — every terminal branch in the reconciler was paired with
  `settleIntent` for the same reason, in the same change.
- This one — a reverted receipt observed inside a dispatch, where the reconciler is never
  involved at all.

Three doors into one room. Each was found by a different incident, each was closed at the branch
that happened to be open, and each fix was locally correct. What none of them established is the
rule: **an outbox row that reaches a terminal state must settle the intent beneath it.** Stated at
each branch, that rule holds only for the branches someone remembered. The next terminal branch
anyone writes will be door four.

### The second bug the same confusion caused

`confirmed` was documented as "a receipt was observed". Nothing read it that way.
`listConfirmedUnsettledIntents` *completes the intent* under a confirmed row.
`settlePendingOrphanedRefunds` reads a confirmed refund transfer as *money that moved* — so a
refund transfer that reverted was recorded as `refunded` and its ledger row resolved, a second
money-losing path from the same writer, found while tracing the first. The reconciler had always
written `failed` for `status === 'reverted'`. The dispatcher was the only writer that disagreed,
and it disagreed on the branch that costs money.

## Considered options

| Option | Pros | Cons |
| ------ | ---- | ---- |
| **Make the dispatcher's record honest, then settle from the record** (chosen) | `confirmed` finally means the same thing in both writers, which is what every reader already assumed. One sweep settles the intent under any `failed` row that names a transaction, so a future terminal branch is covered before it is written. It is also the retry when an inline settlement fails or the process dies mid-verdict | A required `succeeded` predicate touches every dispatch site. Settlement is a worker pass away (~10s) rather than inline, and the pass costs one more query |
| Refund inline where the reverted receipt is observed (rejected) | Immediate, and local to the one code path that has the receipt | This is door number four's design: a fourth special case, a refund decision in request code that ADR-0048 places in settlement, and nothing at all for a process that dies between the receipt and the refund |
| Widen `listStrandedIntents` to admit this row shape (rejected) | No new query, no new sweep | That predicate is load-bearing in the other direction. It exists for a row naming *no* transaction, whose nonce may have been spent by the intent's own work, so it must ask the chain first (ADR-0071). Widening it merges two populations whose evidence differs in kind |
| Let the intent's `validBefore` expire and have the abandoned sweep write it off (rejected) | No new code at all | A timer is not evidence, which is the rule ADR-0045 exists to state. The chain has already answered. It would also be slow for a paid write and wrong for a free one |
| Leave `confirmed` meaning "a receipt was observed" and distinguish reverted elsewhere (rejected) | No change to the outbox contract | Nothing reads it that way. `listConfirmedUnsettledIntents` completes on it and `settlePendingOrphanedRefunds` treats it as money moved -- the documented meaning was the one thing nobody implemented |

## Decision

1. **`confirmed` means the receipt arrived and it succeeded.** This is not a new meaning; it is
   the meaning every reader already assumed and the reconciler already wrote. The dispatcher is
   brought into line: `ServerTransactionRequest` gains a **required** `succeeded(receipt)`
   predicate, and a receipt it rejects is recorded `failed` with its hash. Required, not optional,
   because the failure was a question nobody asked — a new dispatch site now cannot compile
   without answering it.

2. **A `failed` outbox row that carries a hash settles the intent beneath it.**
   `listFailedTransactionIntents` selects non-terminal intents joined to such a row, and
   `settleFailedTransactionIntents` settles each through the *same* `onFailed` the reconciler
   uses. One refund rule, reached from every writer. A writer that settles inline is still
   correct; the sweep finds nothing to do, and becomes the retry when settlement fails, the
   process dies, or a deploy lands mid-verdict.

3. **The hash is the evidence, and its absence is not.** A `failed` row with no hash names
   nothing — its nonce may have been spent by this intent's own transaction — so it is
   deliberately excluded and left to `listStrandedIntents`, which asks the chain about the
   intent's own one-shot receipt first (ADR-0069, ADR-0071). Never refund on absence of evidence.

4. **No cutoff on the new sweep.** The other sweeps wait fifteen minutes because their evidence is
   an absence that time may still fill in. This one waits for nothing: the chain has answered.

## Consequences

- The reverted-receipt case settles within a worker pass (~10s) instead of never.
- The refund-transfer ledger bug closes with it: a reverted refund transfer now leaves its outbox
  row `failed`, so `settlePendingOrphanedRefunds` flags it for retry instead of recording money as
  moved.
- `listConfirmedUnsettledIntents` cannot complete a reverted write even if the intent later
  acquires the hash, because the outbox row is no longer `confirmed`. Completing a reverted write
  would be worse than the bug this fixes, so it has its own regression test.
- Exactly one refund is issued: `onFailed` refuses an intent already `completed` or `failed`, and
  a settled intent no longer matches the sweep's predicate.
- Callers of `dispatchServerWalletTransaction` still see the receipt and still raise their own
  decoded revert errors; nothing about the request-facing behaviour changes.
- The single-instance caveat ADR-0072 records is untouched: this decision adds no new
  refund-on-inference, only refund-on-receipt.
- Cost: one extra query per worker pass, and a type change that every future dispatch site must
  answer.

## References

- ADR-0040 — the dispatcher and outbox this amends
- ADR-0045 — a confirmed on-chain verdict, not a timer, settles an intent
- ADR-0048 — refunds are settlement's decision alone
- ADR-0069 — a missing receipt is not a failed one
- ADR-0071 — the stranded sweep, which owns the hashless `failed` row
- ADR-0072 — the second of the three doors
- `apps/backend/test/integration/relayed-intent-reverted-receipt.test.ts`

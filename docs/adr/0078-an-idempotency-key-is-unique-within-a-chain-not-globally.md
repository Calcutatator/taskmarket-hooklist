# 0078 — An idempotency key is unique within a chain, not globally

> **Decision (Y-statement):** In the context of a `relayed_intents` table whose idempotency key and
> payment reference are both globally unique while the outbox row beneath it is chain-scoped,
> facing a multi-chain deployment in which one backend would serve two chains and their keys would
> collide, we decided to add `chain_id` to the intent and make both uniqueness constraints
> composite on it, to achieve a key that names one operation on one chain, accepting a migration
> that rebuilds two unique indexes on a live money table while it is still nearly empty.

- **Status:** Proposed
- **Date:** 2026-08-10
- **Embodiment:** Verified
- **Last audited:** `[unaudited]`
- **Author:** Claude Code (drafted for review)
- **Deciders:** (pending — Beau)
- **Reviewers:** (pending — no independent reviewer recorded)
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** —
- **Pending Amends / Amended-by:** Pending amends
  [ADR-0052](0052-every-relayed-write-carries-a-client-generated-idempotency-key.md)

## Context

`server_wallet_transactions` — the outbox row an intent sits on top of — carries
`chain_id integer NOT NULL` and composes it into every index it needs to be correct:
`(wallet, chain_id, status)` and `(wallet, chain_id, nonce)`. The nonce allocator is chain-scoped
because a nonce means nothing without the chain it belongs to (ADR-0040).

`relayed_intents` has no `chain_id` at all, and both of its uniqueness constraints are global:

```
uniqueIndex('idx_relayed_intents_idempotency_key').on(idempotencyKey)
uniqueIndex('idx_relayed_intents_payment_tx').on(paymentTxHash)
```

Nothing decided this asymmetry. It is what happens when one layer is built against a
single-chain deployment and the layer beneath it is not — the same shape as ADR-0076's ceiling,
where the replacement path had a bound and the first send did not.

**Today it costs nothing.** Mainnet and Base Sepolia run as separate deployments against separate
databases, so no two chains share a `relayed_intents` table and no key can collide. The defect is
entirely latent.

**Under the multi-chain deployment now being planned it is a correctness failure**, and of the
worst kind: two callers on two chains presenting the same key would collide on a unique index, and
the second would be told its write was already done. ADR-0052 made the key mandatory precisely so
that re-presenting one returns the operation it already has rather than doing the work twice. A key
that spans chains makes that promise wrong — it would return _another chain's_ operation as yours.
The payment reference is the same story: `payment_tx_hash` is only unique within a chain, and two
chains can produce the same hash.

**Why now rather than later.** The migration rebuilds two unique indexes on the table that records
every paid write. Doing that is cheap while the table is nearly empty — production holds a handful
of rows days after launch — and expensive once it holds a year of them, because a unique rebuild on
a live money table under load is exactly the operation nobody wants to schedule. The window where
this is a small change is open now and does not reopen.

## Considered options

| Option                                                                             | Pros                                                                                                                                                                                                               | Cons                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Add `chain_id` and make both uniques composite on it** (chosen)                  | The key then means what ADR-0052 says it means: one operation on one chain. Matches the outbox beneath it, so both layers scope the same way and a reader does not have to remember which one is global. Cheap now | A migration that drops and rebuilds two unique indexes on the money table, plus a backfill for existing rows                                                                                                                                                                  |
| Leave it global and forbid multi-chain deployments (rejected)                      | No migration, no risk today                                                                                                                                                                                        | Makes a latent schema defect into a permanent deployment constraint, enforced by nothing and documented nowhere. The multi-chain deployment is planned, so this defers the same work to when it is most expensive                                                             |
| Namespace the key in the application instead — prefix it with the chain (rejected) | No schema change                                                                                                                                                                                                   | Changes what a key _is_ on the wire, so every client that generated one and every stored key would have to agree on the new format. It also hides the scoping in string manipulation rather than in the constraint that enforces it, which is where a uniqueness rule belongs |
| Add `chain_id` now, swap the indexes later (rejected)                              | Smallest single step, and the expand-then-contract shape this repo uses for contract revisions                                                                                                                     | The column alone fixes nothing — the collision is the index, not the column. It would leave a schema that looks scoped and behaves globally, which is worse than one that is plainly global                                                                                   |

## Decision

1. `relayed_intents` gains `chain_id integer NOT NULL`.
2. Both uniqueness constraints become composite:
   `(chain_id, idempotency_key)` and `(chain_id, payment_tx_hash)`.
3. Existing rows are backfilled from the outbox row they name, which already carries the correct
   chain. Rows with no outbox row — reservations, and intents that never broadcast — keep the
   sentinel `0` the column is added with, which preserves the old global uniqueness among exactly
   those rows and nothing else. The default is dropped afterwards, so every new row must state its
   chain rather than inherit one.
4. Every write sets `chain_id` from the backend's configured chain, and every lookup by
   idempotency key or payment reference is scoped by it. A lookup that forgot the scope would read
   another chain's row, which is the defect this decision exists to remove.

## Consequences

**Positive:**

- A key names one operation on one chain, which is what ADR-0052 always claimed for it.
- The intent and the outbox row beneath it scope the same way, so there is one rule rather than a
  rule and an exception.
- The migration happens while the table is nearly empty, which is the only time a unique-index
  rebuild on this table is uneventful.

**Negative / trade-offs:**

- The sentinel `0` is a real wart. It exists because a migration cannot read the application's
  configured chain, and it is confined to rows that predate this decision and never broadcast.
  Anything reading `chain_id = 0` should treat it as "unknown, and from before this was scoped".
- Two unique indexes are dropped and rebuilt. On a nearly-empty table that is instant; the
  statement order matters if it is ever replayed against a large one.

**Neutral / follow-up:**

- The multi-chain deployment will need more than this — the fee ceiling (ADR-0076), the allocator
  and the facilitator configuration are all per-chain concerns. This closes the one that is cheap
  now and awkward later, and does not claim to make the system multi-chain by itself.

## References

- [ADR-0040 — server wallet transactions use a database-coordinated dispatcher](0040-server-wallet-transactions-use-a-database-coordinated-dispatcher.md)
- [ADR-0045 — relayed writes are durable intents, not request-scoped transactions](0045-relayed-writes-are-durable-intents-not-request-scoped-transactions.md)
- [ADR-0052 — every relayed write carries a client-generated idempotency key](0052-every-relayed-write-carries-a-client-generated-idempotency-key.md)
- [ADR-0057 — a settled payment is one indivisible reference](0057-a-settled-payment-is-one-indivisible-reference-published-by-the-middleware.md)
- `apps/backend/src/db/schema.ts` — `relayedIntents`, `serverWalletTransactions`.

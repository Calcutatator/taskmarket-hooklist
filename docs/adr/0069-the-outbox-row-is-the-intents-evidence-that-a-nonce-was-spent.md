# 0069 — The outbox row is an intent's evidence that a nonce may be spent

> **Decision (Y-statement):** In the context of relayed intents settling against a
> database-coordinated nonce allocator, facing the fact that "this intent has no outbox row and
> no transaction hash" was being read as proof that nothing was ever sent when it only proved
> that no send had *answered*, we decided that the outbox row is linked to its intent at nonce
> allocation and released only on positive evidence that the nonce is free, and that a nonce's
> outcome is read from every hash that has ever held it, to achieve a refund rule that cannot
> pay a payer back for work that landed, accepting that some intents now end in a non-terminal
> state needing manual reconciliation rather than being resolved automatically the wrong way.

- **Status:** Proposed
- **Date:** 2026-08-05
- **Embodiment:** Verified
- **Last audited:** `[unaudited]`
- **Author:** Claude (agent), directed by Beau Williams
- **Reviewers:** (pending)
- **Deciders:** (pending — Beau)
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** —
- **Pending Amends / Amended-by:** Pending amends ADR-0040 (server wallet transactions use a
  database-coordinated dispatcher) and ADR-0045 (relayed writes are durable intents, not
  request-scoped transactions).

## Context

ADR-0040 describes the nonce allocator and its outbox. ADR-0045 through ADR-0068 describe
intents, reservations, settlement and refunds. Nothing states the contract *between* them, and
both layers were written as though it were obvious.

The intent layer's refund rule (ADR-0045, ADR-0048) is that a payment may be returned only on
confirmed evidence that the work did not happen. Two of its queries implement that rule by
reading two columns:

```
serverWalletTransactionId IS NULL AND tx_hash IS NULL
```

and a comment above `listUnbroadcastIntents` explained why this is positive evidence rather
than an inference: "the outbox row is written when a nonce is allocated, which happens before
anything is broadcast, so an intent with no `serverWalletTransactionId` and no `txHash` cannot
have a transaction live under it."

Every clause of that sentence was true except the one that mattered. The outbox row *is*
written at allocation — but it was never **linked to the intent** until `markIntentBroadcast`,
which runs only after `send` returns a hash. So the predicate did not ask "was a nonce
allocated for this intent". It asked "did a send return an answer". Those differ on exactly one
branch, and it is the branch where the transaction may be mining.

Two defects followed from the same unwritten contract.

**A send whose outcome is unknown recycled its nonce.** The dispatcher classified send failures
with `nonceWasConsumed`, a substring allowlist over five phrases. Anything outside it — a timed
out `eth_sendRawTransaction`, a socket reset, a 502 from the gateway — fell to
`else { setStatus(id, 'recycled') }`, which means "the nonce was never spent, return it to the
pool". A send that never returned an answer is precisely the case in which the node may have
taken the transaction. The intent was then left with no linked outbox row and no hash, the
sweep read that as never-sent, and the payment was refunded while the transaction mined: the
task funded on chain out of the server wallet, the payer refunded for it, and nothing anywhere
joining those two facts.

**A replacement whose original mined was never detected.** The reconciler read
`getReceiptStatus(row.txHash)` and nothing else. Once a replacement overwrote `txHash`, the
superseded hash survived only in `replacedTxHash` and no path ever read its receipt. If the
gateway lagged, the replacement went out, and the original then mined, the replacement was
nonce-too-low forever, its receipt null on every pass; escalation ran to the cap, sent its one
clearing transfer (ADR-0066), and the row sat in `broadcast` permanently. The intent still
carried the original's hash, which made it invisible to `onConfirmed`, to
`listConfirmedUnsettledIntents` (whose hash join now compared two different hashes), to
`listAbandonedIntents` (needs `recorded`) and to `listUnbroadcastIntents` (needs a null hash).
Neither served nor refunded, and silent.

Both are the same shape: the intent layer asked a question the dispatcher had not undertaken to
make answerable. That undertaking is what this ADR writes down.

## Considered options

| Option                                                                                                                    | Pros                                                                                                                                                            | Cons                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Link at allocation, recycle only on positive evidence, read every hash a nonce has held** (chosen)                       | Makes the existing predicate true rather than nearly true. No new settlement path, no new columns, no new sweep for the ordinary cases.                          | An intent whose nonce is spent by a transaction we cannot name ends non-terminal and needs an operator. The idempotency key stays held while that is true.                                                                                 |
| Extend the substring allowlist (rejected)                                                                                  | Smallest possible diff.                                                                                                                                         | The failure mode is *unrecognised* errors. Every phrase added leaves the next one, and each addition looks like a fix while the class of defect is untouched. A string match cannot be made exhaustive over an unbounded space of gateways. |
| Widen the refund query to also require a stale `updatedAt`, and keep the send-success link (rejected)                      | No dispatcher change at all.                                                                                                                                    | Time is not evidence. This is the same reasoning ADR-0067 rejected for reservations; a mined transaction is older than any cutoff, not newer.                                                                                              |
| Have the intent layer poll the chain for its own transaction after a failed send (rejected)                                | Would find a mined original even with no hash.                                                                                                                  | Nothing to poll *for*: the hash is what the failed send did not return. Searching by sender and nonce finds *a* transaction and cannot say it was ours — the same "finds a payment, cannot say it is this one" objection ADR-0067 records.  |
| Treat the unknown branch as `failed` and resync the allocator (rejected)                                                   | Terminal, no sweep ever revisits it.                                                                                                                             | `failed` asserts the nonce is spent, which is no better supported than `recycled` asserting it is free. It would also resync the allocator past a nonce that may genuinely be free, reintroducing the issue #54 gap.                        |

## Decision

The dispatcher owes the intent layer three properties. All three are properties of the
dispatcher; none can be established by the queries that depend on them.

1. **A nonce is linked to whatever it was allocated for, at allocation.** The link is written
   before `send` is called, not after it returns. `serverWalletTransactionId` therefore answers
   "was a nonce allocated for this intent", which is the question every sweep is actually
   asking.

2. **`recycled` requires positive evidence.** A nonce returns to the pool only when something
   proves it unspent: a recognised rejection error, or a `getTransactionCount(pending)` read at
   or below the nonce. An unrecognised send error proves nothing and must not recycle; the row
   stays `reserved`, the link stays written, and the reconciler owns it. An unanswered
   freeness read is not a "yes" — it is the same asymmetry ADR-0067 states for
   `authorizationState`, and it resolves the same way. The link is taken back off only on the
   branch that recycled.

3. **A nonce's outcome is read from every hash that has held it.** When the current hash has no
   receipt, the hash it superseded is consulted, because a mined original is a real outcome and
   the only remaining place the chain's answer can be read. It settles through the ordinary
   confirmed path, with the outbox row's hash put back to the one that actually mined.

Two corollaries follow from the same principle, in different sweeps, and are decided here for
the same reason:

4. **A row nothing can identify ends non-terminal, and says so.** When a nonce with no recorded
   hash is proven spent by something we cannot name, the outbox row is terminal (the nonce is
   genuinely spent, so no gap is created) and the intent is left non-terminal with a structured
   error log. It is not refunded — the transaction that spent that nonce may have been its own.
   This is the manual-reconciliation outcome ADR-0067 already established for a reservation
   with a settled payment behind it.

5. **An unconsumed EIP-3009 authorization is not an unpaid one.** `authorizationState` flips
   when the settlement mines, not when it is broadcast, so a `false` covers both "never
   submitted" and "in the mempool". An expired reservation on a `false` is retained and marked
   terminal rather than deleted, so a late-mining authorization stays attributable to the
   `payment_auth_*` write-ahead record ADR-0067 exists to keep.

And one rule about how these outcomes are reported, which is the same class of mistake one
level up: **an outcome is read from a structured value, never from a message.** The two
settlement paths decided whether a refund had failed with `message.includes('refunded')` on a
string that concatenates a decoded revert reason. A revert named like `AlreadyRefunded` would
make a genuinely failed refund read as a success and log nothing — and under ADR-0053 that log
is the entire reporting surface.

Finally, the corollary that closes a state with no exit: **`orphaned_payments.refunding` is
transient because something moves it on, not because time does.** A refund transfer is an
ordinary server-wallet transaction, so its outcome is already in the outbox; the ledger row is
settled by joining its refund hash to that row, and a transfer that was replaced or cleared
settles as `failed` — the money did not move — rather than being left claiming a refund is
under way.

### How to check a future dispatcher change against this

The invariant, stated so it can be tested rather than admired:

> For any relayed intent, if `server_wallet_transaction_id IS NULL AND tx_hash IS NULL`, then
> no transaction sent for that intent can be mined or mining.

A change to the dispatcher, the allocator, or the reconciler is compatible with this ADR only
if it preserves that sentence. Concretely: any new branch that writes `recycled`, or that
clears the link, must be reachable only from evidence that the nonce is free — and "the error
did not match a pattern I recognise" is not that evidence.

## Consequences

**Positive:**

- The refund rule is sound on the branch that used to break it: an intent whose send never
  answered is not refundable, so a payer cannot be repaid for work that landed on chain.
- The comment `listUnbroadcastIntents` has always carried is now true, and the invariant above
  gives a future change something to be checked against.
- A replaced transaction whose original mined completes normally instead of stranding, and the
  outbox row carries the mined hash again, which repairs the hash join
  `listConfirmedUnsettledIntents` depends on.
- `refunding` has an exit, so the ledger stops understating money returned and a payer stops
  being told a refund is in progress indefinitely.
- Two silent states become loud ones: an unidentifiable spent nonce and a superseded refund
  transfer both produce a structured error rather than a plausible-looking row.

**Negative / trade-offs:**

- Some intents now end in a state only an operator can resolve. That is a real cost, and it is
  chosen deliberately over resolving them automatically in the direction that loses money.
- The unknown branch costs one extra `getTransactionCount` call per failed send. Failed sends
  are rare; the read is cheap and off the happy path entirely.
- Retaining an expired reservation holds its idempotency key permanently. A payer who signed an
  authorization against that key and abandoned it cannot reuse it. The key is held because
  money may yet move against it.
- Linking at allocation means an abandoned reservation now has an intent attached to it, so the
  reconciler's replacement of that nonce settles that intent as failed. That is correct — the
  nonce was filled by a self-transfer that did none of the work — but it is a settlement that
  did not previously happen, and it depends on the outbox recording that its current hash is
  not the work.

**Neutral / follow-up:**

- Nothing here changes what counts as confirmed evidence (ADR-0045) or where a refund may be
  decided (ADR-0048). It changes only what the evidence is read from.
- No schema change. The link column, the superseded-hash column and the refund-hash column all
  already exist; what changed is when they are written and what reads them.

## References

- ADR-0040 — Server wallet transactions use a database-coordinated dispatcher (the allocator
  and outbox this states the intent-side contract for).
- ADR-0045 — Relayed writes are durable intents, not request-scoped transactions.
- ADR-0048 — Orphaning a payment is decided only by intent settlement.
- ADR-0050 — Durable writes follow the chain call, and unbroadcast intents are retried before
  refund.
- ADR-0051 — Replacement gas escalates geometrically under a configured cap.
- ADR-0053 — Relayed-write observability is by query, not by alerting.
- ADR-0066 — Replacement stops at the cap, and a single self-transfer clears the nonce.
- ADR-0067 — An intent is reserved before the payment challenge (the "unanswered is not no"
  standard this generalizes).
- Money-path review of the settlement layer, 2026-08-05.

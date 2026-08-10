# 0071 — An intent asks the chain whether its own receipt was consumed

> **Decision (Y-statement):** In the context of relayed intents whose send never returned a
> transaction hash, facing the fact that the chain can only be asked about a transaction by
> hash — so an intent with none had no way to learn whether its work had landed, and was left
> non-terminal and unrefunded — we decided to persist the forwarder receipt key each intent's
> relay call consumes, at nonce allocation, and settle from whether the chain says that key was
> consumed, to achieve an exact per-intent answer that generalizes across operations rather than
> a correlation by payload shape, accepting that two operations which relay nothing still have
> no readable effect and stay non-terminal, and that an intent settled this way completes
> without running its completion handler.

- **Status:** Accepted
- **Date:** 2026-08-06
- **Embodiment:** Verified
- **Last audited:** `[unaudited]`
- **Author:** Claude (agent), directed by Beau Williams
- **Reviewers:** Beau Williams — self-attested; no independent reviewer recorded
- **Deciders:** Beau Williams
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** Amends ADR-0069
- **Pending Amends / Amended-by:** —

## Context

ADR-0069 closed the branch where an unanswered send recycled its nonce, and in doing so it
deliberately opened one state and left it open. Its point 4 says so plainly: a nonce proven spent
by a transaction we cannot name makes the outbox row terminal and leaves the intent
non-terminal, unrefunded, needing an operator. Its Consequences record that as a chosen cost.

The state is reached like this:

1. An intent claims nonce `N` and calls `send(N)`.
2. The RPC connection drops mid-call. No transaction hash is returned, and none is stored.
3. `server-transaction-dispatcher.ts` cannot prove the nonce spent (the error is a timeout, not
   `nonce too low`) and cannot prove it free. The row stays `reserved`, the link stays written,
   and the nonce is not recycled. Correct, and exactly what ADR-0069 decided.
4. The reconciler later attempts a replacement at nonce `N` and gets `nonce too low` — something
   occupies it.
5. `server-transaction-reconciler.ts` makes the outbox row terminal (the nonce is genuinely
   spent, so no gap is created) and leaves the intent alone.

It stops there because the transaction occupying `N` **may have been this intent's own** — the
send that reached the node but never answered. Refunding when it was ours means the requester
holds a funded task on chain *and* their money back, escrow paid out of the server wallet.
Failing to refund when it was not ours means they paid for nothing. Every other outcome in the
settlement layer is resolved by reading a receipt **by hash**, and here there is no hash;
Ethereum JSON-RPC has no "transaction by sender and nonce" lookup, so that mechanism dead-ends.

Every existing sweep is closed to the row, which is why it sat there rather than being caught by
something: `listUnbroadcastIntents` requires a null outbox link, `listConfirmedUnsettledIntents`
joins on a hash it does not have, and `settleAbandonedIntents` explicitly skips anything
carrying a link. That last skip is not an oversight — it is the guard that makes the abandoned
sweep safe — so widening it was never available.

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| **Persist the forwarder receipt key at allocation and read `consumedReceipts`** (chosen) | Exact and per-intent: the key is derived from a receipt nonce minted once per intent, so nothing but this intent's own call can set it. One predicate covers every relaying operation. One `eth_call`, off the happy path. Its `validBefore` is already the deadline the refund rule needs. | A new column and a write on the allocation hook. Two non-relaying operations are still unanswerable. An intent settled this way cannot run its completion handler, which needs a hash. |
| Correlate against indexed events (rejected) | Uses machinery already running; no new column; "the effect appearing is the evidence" is the same question the rest of the settlement layer asks. | Does not survive contact. The forwarder is not an indexed contract, so `PaymentGatedCall` — the only event naming the relay call itself — lands nowhere, and `indexed_events` stores no arguments at all. Correlation would have to run through the projected domain tables with a bespoke predicate per operation, each its own money-safety argument, and several are irreducibly ambiguous because the operation is legitimately repeatable by the same actor against the same target (`acceptance.rate`, `tasks.update`, `submissions.submit`, `bids.submit`, `proofs.submit`). `tasks.create` — the motivating case — is among the weakest, correlated only by requester, reward and block window with no unique key. It would have worked for creates and guessed elsewhere. |
| Recompute the receipt key in the sweep instead of persisting it (rejected) | No column, no migration. | Three of its seven inputs — `pgtrSender`, `paymentAmount`, the selector — exist only inside the broadcast path. Recovering them from a stored payload means re-running the broadcaster, which sends a second transaction. |
| Refund on a stale `updatedAt` (rejected) | No new mechanism at all. | Time is not evidence. ADR-0067 rejected this for reservations and ADR-0069 rejected it again for this exact predicate; a mined transaction is older than any cutoff, not newer. |
| Leave it to an operator, as ADR-0069 chose (status quo) | Nothing can be got wrong automatically. | The cost is paid by whoever is stranded, silently, and there is no alerting — a structured log is the whole reporting surface (ADR-0053). The evidence to resolve it correctly turned out to exist. |

## Decision

**An intent's evidence that its own call landed is the one-shot marker that call consumes, read
from the chain by that marker.**

1. **The forwarder receipt key is persisted at nonce allocation, before the send.** It is
   computed in the relay path, where all seven of its inputs exist together, and written on the
   same hook that writes the outbox link — because both are needed under identical circumstances
   and a value written after the send is missing on exactly the branch it exists for. The key is
   `keccak256(chainId, pgtrSender, paymentAmount, receiptNonce, validBefore, taskMarket,
   selector)`, byte-identical to `TaskMarketForwarder.relay`, and its `receiptNonce` is minted
   once per intent and replayed verbatim (ADR-0050), so the key identifies the *intent* and not
   one attempt at it.

2. **A stranded intent is settled from a three-valued verdict, never a two-valued one.**
   `landed` completes it, without refund. `absent` past the deadline the chain itself enforces
   fails it and refunds it. Everything else — absent but still inside the deadline, an
   unanswered read, an operation with no readable effect — leaves the intent exactly as it was.

3. **A failed read is not a `false`.** An RPC error, a timeout or an unreachable node is not the
   chain saying the work did not happen. This is the same asymmetry ADR-0067 states for
   `authorizationState` and ADR-0069 states for `nonceIsUnused`, and it resolves the same way:
   the read throws, the caller records `unknown`, and the intent stays open. Collapsing it would
   refund a payer for a task they already hold — the precise loss this mechanism exists to
   prevent.

4. **Absence is evidence only past the bound the chain enforces, and that bound is per
   operation.** A relayed call is bounded by the envelope's `validBefore`, which
   `TaskMarketForwarder.relay` reverts `ReceiptExpired` past. A `wallet.withdraw` is bounded by
   the user's own EIP-3009 `validBefore` inside the authorization they signed, which the token
   enforces. Before either, the transaction whose send never answered may still be in a mempool
   and may still be included; after it, no transaction carrying this intent's material can ever
   be included, so an absent effect is absent permanently.

5. **`wallet.withdraw` is answered by EIP-3009 `authorizationState`, not by a receipt key.** It
   does not relay; it sends the user's authorization directly to the token. But the token
   records every consumed authorization under `(authorizer, nonce)`, which names this withdrawal
   exactly — the same lookup, and the same safety argument, the reservation sweep already relies
   on (ADR-0067).

6. **Coverage is stated, not implied: 24 of 26 operations.** The 23 that relay are answered by
   the receipt key; `wallet.withdraw` by `authorizationState`. **`wallet.withdrawDreams` and
   `identity.register` are not covered** — they call the DREAMS hook and the ERC-8004 registry
   directly, and neither carries a per-intent one-shot marker readable after the fact. Those two
   stay non-terminal and are named in code and here. A mechanism that silently covered some
   operations would be worse than one that states its scope, because the gap would then be
   discovered by someone being stranded rather than by reading this.

7. **Rows with no persisted key stay non-terminal.** Every intent written before the column
   existed has a null there. A null means there is no question to ask — not that the answer is
   no. There is no backfill, because there is nothing to backfill *from*: the inputs are gone.
   Those rows are the pre-existing manual-reconciliation population and remain exactly that.

8. **An intent settled this way completes without running its completion handler.** The handler
   takes the transaction hash and several write it to a `NOT NULL` column; the hash is precisely
   what this intent never got. The chain-derived half of the projection belongs to the indexer
   anyway — it writes the task, claim, submission and proof rows from the events these calls
   emit, keyed on the hash it reads off the log — so what is lost is the off-chain half. That is
   reported as a structured error rather than completed quietly.

### How to check a future change against this

ADR-0069's invariant still holds and is unchanged. This one sits beside it:

> An intent may be failed and refunded from an absent effect only when the effect was read by a
> marker that names that intent alone, and only past a deadline the chain itself enforces.

A new operation added to the settlement layer is compatible with this ADR only if it either
supplies such a marker or is added to the stated uncovered list. Widening the rule to an effect
recognised by shape — payload fields, actor, block window — is the option this ADR rejected, and
rejecting it is most of the decision.

## Consequences

**Positive:**

- The state ADR-0069 left for an operator is resolved automatically for 24 of 26 operations, in
  the only two directions the evidence supports.
- The evidence is exact rather than probabilistic. "Did this call land" is a lookup on a key
  nothing else can set, not a search for something of the right shape.
- The deadline governing refund is the one the chain enforces, per operation, so it cannot drift
  from what the payer actually authorised.
- The uncovered operations are named in code, in the ADR, and in a structured log, so being
  stranded on one is discoverable rather than silent.

**Negative / trade-offs:**

- A new nullable column and a second write inside the allocation hook, on every relayed
  broadcast, for a branch that is rare. The write is one `UPDATE` already being issued.
- Two operations remain exactly as ADR-0069 left them. This is a real gap, chosen over guessing.
- An intent completed this way has no off-chain completion side effects. For `wallet.withdraw`
  and `wallet.withdrawDreams` the handlers are empty and nothing is lost at all; for the others
  the chain-derived rows still arrive via the indexer, but notifications and any handler-only
  writes do not.
- The receipt key must stay byte-identical to the Solidity. A drift would make every stranded
  intent read as never-landed, and past its deadline that refunds work that is on chain. This is
  the single most dangerous line in the change, so its test compares against a value produced by
  Foundry evaluating the Solidity expression, not by the code under test.

**Neutral / follow-up:**

- Nothing here changes what counts as confirmed evidence (ADR-0045) or where a refund may be
  decided (ADR-0048). It adds one more thing the chain can be asked, and one more sweep to ask
  it from.
- If `wallet.withdrawDreams` or `identity.register` ever gain a per-call one-shot marker, they
  join the covered set with no change to the rule.

## References

- ADR-0045 — Relayed writes are durable intents, not request-scoped transactions.
- ADR-0048 — Orphaning a payment is decided only by intent settlement.
- ADR-0050 — Durable writes follow the chain call; the relay envelope is pinned and replayed.
- ADR-0053 — Relayed-write observability is by query, not by alerting.
- ADR-0067 — An intent is reserved before the payment challenge (the `authorizationState`
  lookup and the "unanswered is not no" standard this reuses).
- ADR-0069 — The outbox row is an intent's evidence that a nonce may be spent (the ADR this
  amends; its point 4 is the state closed here).
- `packages/contracts/src/TaskMarketForwarder.sol` — `consumedReceipts` and the receipt hash.

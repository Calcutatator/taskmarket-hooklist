# 0063 — The reconciler settles a nonce spent by a foreign transaction

> **Decision (Y-statement):** In the context of the ADR-0040 server-wallet dispatcher assuming it
> is the only writer for the relayer account, facing deploys and operator scripts that sign with
> the same key and consume a nonce the allocator had already issued, we decided to treat an
> advanced chain nonce count plus a still-absent receipt, observed in that order and only past
> the stuck threshold, as conclusive evidence the row can never mine and settle it terminally as
> failed, to achieve a reconciler that always converges instead of retrying a rejected
> replacement forever, accepting one extra RPC read per stuck row and a small residual risk of
> failing a row a badly lagging endpoint could not confirm.

- **Status:** Proposed
- **Date:** 2026-08-05
- **Embodiment:** Not started
- **Last audited:** `[unaudited]`
- **Author:** Claude Code (drafted for review)
- **Reviewers:** (pending — no reviewer recorded yet)
- **Deciders:** (pending — required before Status may become Accepted)
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** Amends ADR-0040; amended by ADR-0072
- **Pending Amends / Amended-by:** —

## Context

ADR-0040 moved server-wallet nonce allocation into Postgres and added a background reconciler
that settles transactions outliving their request and replaces nonces stuck at the head of the
queue. Its recovery mechanism is the replacement transaction: a zero-value self-transfer sent at
the stuck nonce with escalated gas, which supersedes whatever was there and unblocks everything
queued behind it.

That mechanism rests on an assumption ADR-0040 states but does not enforce: the dispatcher is the
only writer for the relayer account. Operationally that assumption is routinely false. The same
key is configured as `FORGE_DEV_PRIVATE_KEY` for contract deploys and upgrades, so a
`forge script --broadcast` run against a live environment signs transactions with the wallet the
backend is concurrently allocating nonces for.

When that happens, the foreign transaction mines at a nonce the allocator had already handed out.
The backend's own transaction at that nonce is dropped from every mempool, and the reconciler
enters a state none of its branches handle:

1. `getReceiptStatus(row.txHash)` returns null, and will return null forever — that hash is not
   going to be mined by anyone.
2. Neither the `success` nor the `reverted` branch fires.
3. Past the stuck threshold the row reaches `replaceStuckNonce`, whose replacement is rejected
   `nonce too low`, because the nonce is already spent.
4. The rejection is swallowed by a catch whose comment asserted the benign interpretation — that
   the original must have landed and the next pass will read its receipt. That reading is correct
   when our own transaction won the nonce, and wrong here.
5. The row stays `broadcast` and re-sends the same doomed replacement on every pass, forever.

The reconciler never converges. On `main` the visible consequence is a permanently stuck outbox
row and a recurring log line, not a stranded payment — there is no intent-settlement layer on
this branch — but it is a liveness hole in the mechanism ADR-0040 introduced specifically so that
recovery would not need an operator restart.

The missing signal is that the chain itself already knows the nonce is gone. The wallet's
transaction count at `latest` is the number of nonces consumed; once it exceeds the row's nonce,
something occupied that nonce. What the count alone cannot say is *what* occupied it, because our
own transaction mining advances the count identically.

## Considered options

| Option                                                                                          | Pros                                                                                                                                                            | Cons                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Nonce count past the row, then re-read the receipt; settle failed only if still absent (chosen)   | Uses evidence the chain already publishes; the receipt re-read, not the count, decides the outcome, so a transaction of ours that did mine settles correctly     | One extra RPC read per stuck row per pass; not a total proof against an arbitrarily stale endpoint                                                                                                            |
| Nonce count past the row alone, no receipt re-read (rejected)                                     | Simplest; one RPC call                                                                                                                                          | Actively wrong: our own transaction mining advances the count too, so this marks successful transactions failed. The count is ambiguous by construction                                                       |
| Treat any transaction unmined past a timeout as failed (rejected)                                 | No new RPC surface at all; trivially converges                                                                                                                  | ADR-0040 deliberately rejected this. A transaction can sit unmined for a long time and then land; failing it on a clock alone re-introduces exactly the reporting that dispatcher was built to avoid          |
| Leave it to a manual operator sweep (rejected)                                                    | Zero code; an operator who caused the collision has the context to resolve it                                                                                   | Reinstates the operator-restart dependency ADR-0040 existed to remove. The condition is silent — a repeating log line among many — so the sweep only happens once someone notices, which may be never         |
| Stop the collision at the source: give deploys their own key (complementary, not a substitute)    | Removes the common cause rather than the symptom                                                                                                                | Correct and pursued separately in ADR-0064, but it is a policy about how keys are used and cannot make the reconciler robust. Any future foreign signer reintroduces the hang; the reconciler must still converge |

## Decision

When a `broadcast` row is past the stuck threshold, the reconciler reads the wallet's transaction
count at `latest`. If the count has passed the row's nonce, it re-reads the receipt for the row's
hash; if the receipt is now present the row settles as `confirmed` or `failed` per its status,
and if it is still absent the row settles terminally as `failed` with the reason recorded. Only
when the count has not passed the nonce does the pre-existing replacement path run. A failure to
read the count settles nothing and falls through to that same replacement path.

The read order is load-bearing. The count is observed first and the receipt second, so the read
that decides the outcome is never the older view of the pair. Combined with the branch running
only past the stuck threshold — 90 seconds by default, orders of magnitude beyond replica lag —
a row that survives both checks is one the chain has moved past and that has had no receipt for
a minute and a half. Settling it creates no allocator gap, because the nonce is already spent.

## Consequences

**Positive:**

- The reconciler converges in the one state where it previously could not, with no operator
  involvement, which is the property ADR-0040 was built to provide.
- The wasted gas and log noise of an endlessly re-sent, always-rejected replacement stop.
- The terminal row records why it failed, so the collision is diagnosable after the fact rather
  than presenting as an unexplained transaction that never happened.

**Negative / trade-offs:**

- One additional `eth_getTransactionCount` per stuck row per pass. Bounded by the pass row cap
  and only paid by rows already past the stuck threshold, so negligible in practice.
- The residual risk is real but narrow: an endpoint lagging more than the stuck threshold, and
  lagging on the receipt read specifically after having served the advanced count, could cause a
  row that did mine to be recorded failed. The window is large enough to make this a
  configuration fault rather than ordinary propagation.
- A terminally failed row is a report of a write that did not happen. Callers already have to
  handle that outcome, but it now occurs in a case where it previously would have hung instead.

**Neutral / follow-up:**

- This makes the dispatcher tolerant of a foreign signer; it does not make sharing the key safe.
  ADR-0064 removes the common cause by moving deploy and owner operations to a separate EOA.
- `smoke-nonce` gains a fault-injection step that mines a foreign transaction at an allocated
  nonce and asserts the row settles terminally, alongside the existing stranded-nonce step.

## References

- ADR-0040 — the dispatcher and reconciler this amends.
- ADR-0064 — the separate deployer/owner EOA that removes the usual cause of the collision.
- `apps/backend/src/lib/server-transaction-reconciler.ts`
- `apps/backend/src/scripts/smoke-nonce.ts`

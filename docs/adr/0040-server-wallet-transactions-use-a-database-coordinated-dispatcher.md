# 0040 — Server-wallet transactions use a durable nonce allocator and outbox

> **Decision (Y-statement):** In the context of every backend transaction sharing one relayer
> account across concurrent requests and replicas, facing process-local nonce state that drifts
> permanently after a pre-broadcast failure, we decided to move nonce allocation into Postgres,
> simulate before allocating, return a provably-unbroadcast nonce to a recycled pool, and hand
> unconfirmed transactions to a background reconciler that replaces stuck nonces, to achieve
> gap-free nonce sequencing without serializing relayer throughput, accepting a durable outbox
> and a reconciliation loop as new operational surface.

- **Status:** Accepted
- **Date:** 2026-08-03
- **Embodiment:** Verified
- **Last audited:** 2026-08-03
- **Author:** Codex (drafted for review); revised to an Engine-style architecture
- **Reviewers:** Codex — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** Supersedes ADR-0019
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** Amended by ADR-0045; amended by ADR-0069
- **Pending Amends / Amended-by:** —

## Context

All backend-mediated contract calls are signed by one server wallet. ADR-0019 attached viem's
process-local nonce manager to that account to stop concurrent calls in one process from selecting
the same nonce. That fixed the original concurrency race but introduced a different source of
truth: the manager increments its cached nonce before the transaction is necessarily broadcast.

On 2026-08-01, a `wallet.withdraw` request attempted to transfer more USDC than its source wallet
held. Gas estimation failed deterministically before broadcast, so the chain remained at nonce
15486 while the nonce manager advanced its cache to 15487. Every later relayer transaction used a
higher nonce and remained pending behind the missing nonce until the backend restarted and cleared
the cache. The incident occurred on one continuously running Railway replica; replica replacement
was not the trigger.

Three properties are required of any replacement:

1. A deterministic preflight failure must consume no nonce.
2. Nonce state must survive process restarts and coordinate replicas, since the in-memory cache
   could do neither.
3. A gap that does occur must heal without an operator restart. The incident's real cost was not
   the failed withdrawal; it was that every subsequent paid transaction stayed stuck until a human
   noticed.

A fourth property emerged from reviewing the first attempt at this fix: the mechanism must not
hold a database transaction, connection, or lock while waiting on the chain. Confirmation latency
is unbounded, and an open Postgres transaction spanning it pins the xmin horizon and blocks
autovacuum database-wide — turning a stalled relayer into a degraded database.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Durable nonce allocator plus outbox and background reconciler, modelled on thirdweb Engine (proposed) | Deterministic failures consume no nonce; nonce state survives restart and coordinates replicas; recycled nonces prevent gaps; stuck nonces heal automatically; transactions stay concurrent; no database work spans an RPC call | Adds two tables, a reconciliation loop, and replacement-transaction gas cost |
| Global advisory lock held from simulation through confirmation (rejected) | Simple; strictly serial, so no gap can form | Holds a database transaction across unbounded RPC latency, pinning the xmin horizon; caps all relayer throughput at one transaction per confirmation; a dropped transaction wedges the relayer until an operator restarts it |
| Adopt thirdweb Engine or an equivalent hosted relayer (deferred) | Solves nonce management, rebroadcast, and recovery as a product; no infrastructure to own | New vendor dependency and cost; server-wallet custody moves outside this codebase; too large a change to make during an incident response |
| Reset viem's nonce manager after submission errors (rejected) | Small change; retains concurrent submission | Cannot reliably distinguish a pre-broadcast failure from an accepted transaction whose response was lost; remains process-local and cannot coordinate replicas |
| Process-local mutex around the existing wallet client (rejected) | Simple; prevents same-process races | Does not coordinate replicas or rolling deployments; cached nonce can still diverge from chain state |

The proposed option deliberately adopts the architecture of thirdweb Engine — decoupled nonce
assignment, a recycled-nonce pool, and a background rebroadcast worker — without adopting Engine
itself. Whether to eventually buy rather than build this remains open, and is recorded as follow-up
below rather than settled by this ADR.

## Decision

If accepted, every runtime transaction signed by the server wallet goes through one dispatcher
with three strictly ordered phases.

**Phase 1 — simulate.** The exact call is simulated before any nonce exists. A deterministic revert
throws here having consumed nothing. This alone would have prevented the incident.

**Phase 2 — allocate.** `server_wallet_nonces` holds one row per `(wallet, chain)` carrying the
next nonce to issue. It is seeded once from the chain's pending transaction count and advanced
thereafter entirely in the database, so allocation performs no RPC call. Allocation prefers an
available recycled nonce over a new one and takes it with `FOR UPDATE SKIP LOCKED`, so concurrent
dispatchers select different rows rather than queueing. Each allocation writes a
`server_wallet_transactions` row. This phase is one short transaction holding only row locks.

**Phase 3 — broadcast and confirm.** Both run with no database transaction open, and multiple
transactions may be in flight at different nonces concurrently.

- A send rejected by the provider means the nonce never reached the mempool, so the row becomes
  `recycled` and the next allocation reuses that nonce. No gap forms.
- A send rejected with a stale-nonce or already-known signature proves the nonce is spent or
  already in flight. The row becomes `failed` and the allocator resyncs upward from the chain.
- A confirmation exceeding the request's bounded budget does not fail the transaction. The row
  stays `broadcast`, the dispatcher raises `ServerTransactionPendingError`, and ownership passes to
  the reconciler. Callers must treat this as in-flight and must not resubmit the same intent.

**Reconciliation.** A background loop settles `broadcast` rows whose receipts have landed, and
replaces any nonce blocking the queue — a transaction unmined past a stuck threshold, or a
`reserved` row abandoned by a process that died between allocating and broadcasting — with a
zero-value self-transfer at that nonce and escalated gas. Recovery therefore does not require an
operator restart, which is the failure mode the incident actually exposed.

Because viem's nonce manager is removed, a write bypassing the dispatcher has no nonce protection
at all. A structural test asserts that no runtime `writeContract`, `sendTransaction`,
`sendRawTransaction`, or `deployContract` call sits outside `dispatchServerWalletTransaction`,
excepting the reconciler's own replacement path.

## Consequences

**Positive:**

- A deterministic simulation failure cannot advance nonce state or create a chain gap.
- Nonce state is durable and shared, so restarts and replicas cannot diverge.
- A failed broadcast returns its nonce to the pool instead of skipping it.
- A stuck or abandoned nonce is cleared automatically rather than by operator restart.
- Relayer transactions remain concurrent; on-chain throughput is not capped by confirmation
  latency.
- No database transaction, connection, or lock is held across an RPC call.

**Negative / trade-offs:**

- Two new tables and a reconciliation loop to operate and monitor.
- Replacement transactions cost gas, and a chain-wide fee spike could cause repeated replacement
  attempts. The stuck threshold is deliberately conservative.
- `ServerTransactionPendingError` is a new outcome callers must handle: a transaction that is
  neither confirmed nor failed. Treating it as failure risks double-submitting an intent. ADR-0045 amends this
  decision with the durable-intent mechanism that handles it.
- The allocator can drift if the server wallet is ever used outside this dispatcher. The resync
  path recovers from drift upward, but not from a nonce consumed out of band mid-sequence.

**Neutral / follow-up:**

- Whether to adopt thirdweb Engine or an equivalent instead of owning this infrastructure warrants
  its own ADR. This decision records an architecture, not a permanent build-versus-buy answer.
- Storing signed raw transactions would let the reconciler rebroadcast the original intent rather
  than replace it with a no-op. That is a strictly larger change and is not proposed here.
- Alerting on rows stuck in `broadcast` or `reserved`, and on replacement frequency, should
  accompany the rollout.
- ADR-0019 is superseded by this decision; the relationship is recorded bindingly on both records,
  and its Embodiment is `Deprecated` because the nonce-manager code it described has been removed.
- ADR-0039's singleton RPC gateway still owns runtime clients and transport accounting; nonce
  coordination belongs to this dispatcher rather than to the gateway account.

## References

- [Incident issue daydreamsai/skills-market#54](https://github.com/daydreamsai/skills-market/issues/54)
- [ADR-0019 — Server wallet uses a nonce manager to serialize concurrent relayed calls](0019-server-wallet-nonce-manager-for-concurrent-relayed-calls.md)
- [ADR-0039 — Singleton RPC gateway owns runtime clients and transport accounting](0039-singleton-rpc-gateway-owns-runtime-clients-and-transport-accounting.md)
- `apps/backend/src/lib/server-transaction-dispatcher.ts`
- `apps/backend/src/lib/server-transaction-store.ts`
- `apps/backend/src/lib/server-transaction-reconciler.ts`
- `apps/backend/test/unit/lib/server-transaction-dispatcher.test.ts`
- `apps/backend/test/unit/lib/server-transaction-reconciler.test.ts`
- `apps/backend/src/scripts/smoke-nonce.ts`
- `apps/backend/src/scripts/smoke-withdraw.ts`

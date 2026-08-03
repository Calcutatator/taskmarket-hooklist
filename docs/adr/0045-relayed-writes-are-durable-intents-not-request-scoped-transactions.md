# 0045 — Relayed writes are durable intents, not request-scoped transactions

> **Decision (Y-statement):** In the context of paid write paths whose on-chain transaction can
> outlive the HTTP request that started it, facing a refund path that currently treats "we stopped
> waiting" as "it failed", we decided to persist each relayed write as a durable intent that the
> reconciler carries to completion, with the request reporting progress rather than owning the
> outcome, to achieve settlement decisions made only on confirmed on-chain results, accepting that
> every paid endpoint becomes asynchronous and its client contract changes.

- **Status:** Accepted
- **Date:** 2026-08-03
- **Embodiment:** Verified
- **Last audited:** 2026-08-03
- **Author:** Claude Code (drafted for review)
- **Reviewers:** None recorded — drafted for review, no independent reviewer yet
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** Amends ADR-0040; amended by ADR-0046; amended by ADR-0047; amended by ADR-0049
- **Pending Amends / Amended-by:** —

## Context

ADR-0040 replaced the server wallet's process-local nonce cache with a durable allocator and
outbox. It introduced a third request outcome alongside success and failure:
`ServerTransactionPendingError`, meaning the transaction was broadcast but no receipt arrived
within the request's budget. It also recorded, as follow-up, that "callers must handle this new
outcome" and that "treating it as failure risks double-submitting an intent."

That follow-up is not yet honoured, and the gap is live on `main`.

`tasks.router.ts` wraps task creation in a broad `catch`. Any error after x402 settlement is routed
to `handlePostPaymentFailure`, which records an orphaned payment and issues an automatic refund.
A pending error takes that path. The reconciler may then land the very transaction that was
declared failed, producing a task that exists on-chain, funded from the server wallet, whose
payer has already been refunded.

The failure predates ADR-0040: before it, the same receipt timeout threw viem's own timeout error
into the same `catch` with the same result. What changed is that the state now has a name and a
durable row, so it is finally distinguishable from a genuine failure.

Two decisions were being conflated and need separating:

1. **How long the HTTP request waits.** An operational choice about connections and latency.
2. **When the system concludes the write failed.** A settlement decision about money.

A timeout answers only the first. Using it to answer the second is the defect.

There are exactly three terminal outcomes for a broadcast transaction, and only two are failures:

| Outcome | Evidence | Settlement |
| --- | --- | --- |
| Succeeded | Receipt with `status: success` | Complete the intent; never refund |
| Reverted | Receipt with `status: reverted` | Nonce spent, work not done; refund correct |
| Never landed | Reconciler's replacement at the same nonce mined instead | Refund correct |

The reconciler already distinguishes all three. It has no way to tell the payment layer, and no
record of what the transaction was *for*.

That last point is the crux. Today the database write for a created task happens inline, after
`waitForTransactionReceipt`, in the same request. If the request returns before the receipt
arrives, that code never runs — so a late success produces a funded, created, on-chain task with
no database row and no notification. That is worse than the refund bug, because it is silent.
Fixing the refund decision alone is therefore not sufficient: something has to be able to finish
the job after the request is gone.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Durable intents completed by the reconciler (proposed) | Settlement decided only on confirmed on-chain evidence; a late success still produces the task row, notifications and awards; crash-safe, since the intent survives process death; one mechanism for every paid path rather than per-router rescue logic | Every paid endpoint becomes asynchronous and its client contract changes; needs an intent table, a completion handler per operation, and client work in CLI and web |
| Bounded wait, no settlement consequence (rejected) | Small change; fixes the refund bug immediately; request stays synchronous in the common case | Leaves the silent gap: a late success still has no code path to write the task row, so the worst outcome moves from "wrongly refunded" to "invisible" |
| Wait until fully resolved, no early return (rejected) | Simplest possible reasoning; the request always knows the real answer | A congested chain holds an HTTP request and its connection open for minutes; a genuinely stuck transaction holds it until the reconciler's replacement mines, which is unbounded from the caller's point of view |
| Keep timeout-triggered refunds and accept the risk (rejected) | No work | Double-spends an escrow whenever the chain is slow; already reachable today |

The rejected bounded-wait option is worth naming precisely because it is tempting: it fixes the
visible bug in a few lines. It is rejected on the grounds that it fixes the wrong half. The
refund is the symptom; the request owning the outcome is the cause.

## Decision

If accepted, a relayed write is recorded as a durable intent before any payment-consuming or
chain-mutating step, and the intent — not the request — owns the outcome.

**Intent lifecycle.** Each paid or relayed write persists an intent row carrying its operation
kind, the validated inputs needed to complete it, the payment reference where one exists, and a
link to the `server_wallet_transactions` row once a nonce is allocated. Status moves
`recorded → broadcast → completed | failed`. The reconciler owns the terminal transition for any
intent that was actually broadcast — nothing else may conclude anything about a live transaction.
Dispatch itself records the one class of terminal state that needs no chain observation: a
deterministic pre-broadcast failure, where simulation reverts before a nonce is ever allocated, so
nothing was signed and nothing can land later. An unpaid intent in that position is marked `failed`
by `dispatchRelayedIntent`; a paid one still reaches `failed` through settlement, which is the only
place allowed to decide a payment is orphaned.

**Settlement is evidence-based.** A refund is issued only on a reverted receipt or on a confirmed
replacement, per the table above. No timeout, cancelled request, disconnected client, or process
restart may cause a refund. This is the rule the current code breaks.

**Completion is idempotent and belongs to the intent.** The work that today runs inline after the
receipt — writing the task row, recording awards, sending notifications — moves into a completion
handler keyed on the intent, so it runs whether the receipt arrives during the original request or
during a reconciler pass an hour later. Execution is **at least once**, not exactly once: a
conditional claim narrows completion to a single caller per attempt, but a process that dies
mid-handler leaves the intent claimable and a later pass reruns it from the start. The handler's
side effects must therefore be idempotent and tolerate partial prior application. Keying on the
intent is what makes that possible: the same intent id identifies the same work across the original
request and every subsequent reconciler pass.

**The request reports progress.** It may still wait a bounded time and return the completed result
in the common case. When it returns early it reports the intent identifier and its state, and that
return carries no settlement meaning whatsoever.

**Clients gain an explicit in-flight state.** Pending is surfaced as its own outcome rather than a
generic 500, with the intent identifier and transaction hash as structured fields, and is
resolvable through the existing `pendingActions` shape so agents already polling need no new
integration. Clients must never resubmit an intent that is in flight.

## Consequences

**Positive:**

- A payment is refunded only when the chain has confirmed the work did not happen.
- A late success still produces the task, awards and notifications instead of vanishing.
- Crash safety: an intent survives process death, so a deploy mid-transaction no longer strands it.
- One mechanism covers every paid path, replacing per-router rescue logic that has already been
  the subject of two incidents.
- The reconciler gains a real purpose beyond nonce hygiene: finishing work.

**Negative / trade-offs:**

- Every paid endpoint becomes asynchronous in the worst case, which is a client-visible contract
  change across CLI, web and any external agent.
- A completion handler is needed per operation kind; each is a place a future operation can forget
  to register, so the registry needs a structural test the way the dispatcher bypass guard has one.
- Completion handlers must be genuinely idempotent, since a reconciler pass can race a late
  request completion.
- More state to operate: intents can accumulate in non-terminal states and need alerting, the same
  way `server_wallet_transactions` rows do.

**Neutral / follow-up:**

- Migration order matters. The refund rule can be enforced before every completion handler exists,
  by refusing to refund on a pending outcome; that narrows the live defect without pretending the
  larger change has shipped.
- This amends ADR-0040 rather than superseding it: the allocator, outbox and reconciler are
  unchanged, and this decision gives the reconciler a second responsibility.
- Whether external agents need a webhook rather than polling is deliberately out of scope.
- **2026-08-03 framing correction (see ADR-0047).** This ADR is written around the refund
  defect it fixes, and so understates what it introduced: a settlement layer that syncs the
  chain to the database. It also does not say that a paid write is inherently a chain of two
  on-chain transactions — an x402 payment we *observe* (broadcast by the facilitator) and a
  forwarded contract call we *dispatch* — which is what `orphaned_payments` compensates for by
  hand. No decision here changes; ADR-0047 states the model.

## References

- [ADR-0040 — Server-wallet transactions use a durable nonce allocator and outbox](0040-server-wallet-transactions-use-a-database-coordinated-dispatcher.md)
- [Incident issue daydreamsai/skills-market#54](https://github.com/daydreamsai/skills-market/issues/54)
- `apps/backend/src/lib/server-transaction-dispatcher.ts` — raises `ServerTransactionPendingError`
- `apps/backend/src/lib/server-transaction-reconciler.ts` — already distinguishes the three terminal outcomes
- `apps/backend/src/routers/tasks.router.ts` — the broad `catch` that currently refunds on pending
- `apps/backend/src/services/orphaned-payments.ts` — the refund path this constrains

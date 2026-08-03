# 0046 — Relayed intents chain follow-on writes rather than relaying inside handlers

> **Decision (Y-statement):** In the context of paid operations whose post-receipt work itself
> makes a further on-chain call, facing a completion-handler contract that forbids relaying,
> we decided to let a completion handler enqueue a follow-on intent instead of broadcasting
> directly, to achieve one durable record per on-chain transaction with no untracked writes,
> accepting that a single user action can span several intents and completes progressively.

- **Status:** Accepted
- **Date:** 2026-08-03
- **Embodiment:** Verified
- **Last audited:** 2026-08-03
- **Author:** Claude Code (drafted for review); decision made directly by Beau in conversation
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** Amends ADR-0045
- **Pending Amends / Amended-by:** —

## Context

ADR-0045 established that a relayed write is a durable intent, and that its completion handler
runs once the transaction is confirmed. That handler was specified as doing no chain work: it
runs after confirmation, and anything it broadcast would be a transaction with no durable record
of its own — precisely the condition ADR-0045 exists to eliminate.

Reading the paid paths against that contract surfaced a case the contract cannot express.
`tasks.create` does not finish at the escrow receipt. When the task carries an evaluator, it then
calls `contractAssignEvaluator` and updates the task row from the result. The post-receipt work is
not database-and-notifications; it contains a second relayed write.

This is not unique to task creation. Any operation whose on-chain effect is expressed as more than
one transaction has the same shape, and the number of such paths is expected to grow rather than
shrink.

Two consequences follow. First, wiring `tasks.create` as a single handler is impossible without
breaking the contract. Second, whichever way this is resolved applies to several endpoints, so it
is worth deciding once rather than per-router.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| A completion handler may enqueue a follow-on intent (selected) | Every on-chain transaction keeps exactly one durable record; the existing reconciler settles each link with no new settlement logic; a crash between links resumes from the last completed one | A single user action spans several intents, so "did my task get created" has a progressive answer; the chain must be acyclic and bounded, which needs enforcing |
| Let handlers broadcast directly (rejected) | Smallest change; keeps one intent per user action | Reintroduces exactly the untracked-transaction problem ADR-0045 removes: the second write has no intent, so a timeout or crash around it is unrecoverable and invisible |
| Fold every transaction of an operation into one intent with a step cursor (rejected) | One record per user action, so status stays simple to answer | The intent row becomes a bespoke state machine per operation; each step still needs its own outbox linkage, so the reconciler ends up reimplementing chaining with worse ergonomics |
| Require operations to be single-transaction (rejected) | Trivially satisfies ADR-0045 | Not achievable: evaluator assignment is a separate contract call by design, and forcing it into the create call is a contract change made for the convenience of a backend mechanism |

## Decision

A completion handler may not broadcast. It may **enqueue a follow-on intent**, which the ordinary
dispatch path then picks up and the ordinary reconciler then settles.

- An intent records an optional parent. A follow-on is created only from within its parent's
  completion handler, so it cannot exist until the parent's transaction is confirmed on chain.
- Each link is a normal intent: one durable record, one transaction, settled by the same
  evidence rules as any other (ADR-0045). Nothing about settlement changes.
- Chains are acyclic and depth-bounded. A follow-on may not name an ancestor as its parent, and a
  chain exceeding the configured maximum depth is a recorded failure rather than an unbounded
  cascade.
- A payment belongs to the **root** intent only. A follow-on carries no payment reference, so a
  chain can never refund more than once, and a failed follow-on refunds against the root.
- Failure of a follow-on does not undo a completed parent. The parent's transaction is already
  on chain and cannot be retracted; the chain records where it stopped and the refund decision is
  made against the root's payment.

Progress is reported per chain: an operation is complete when its terminal intent completes, and
the root's identifier is what callers hold onto.

## Consequences

**Positive:**

- The invariant that matters holds without exception: every on-chain transaction has exactly one
  durable record, whoever initiated it.
- Multi-transaction operations become resumable. A crash between the escrow and the evaluator
  assignment leaves a completed parent and an unstarted follow-on, and the next pass continues.
- No new settlement machinery: chaining reuses dispatch and reconciliation unchanged.

**Negative / trade-offs:**

- A user action can be partially applied — task created, evaluator not yet assigned — so client
  status is progressive rather than binary, and the API must be able to express that.
- Depth and cycle limits are real constraints that need enforcing rather than assuming.
- Reasoning about "what happened to my request" now means reading a chain, not a row, which is
  more to hold in mind during an incident.

**Neutral / follow-up:**

- Whether a failed follow-on should attempt compensating on-chain action is deliberately out of
  scope. Today it does not, and the parent's effect stands.
- Alerting should treat a chain stalled with an unstarted follow-on the same as an intent stuck
  in `recorded`.

## References

- [ADR-0045 — Relayed writes are durable intents, not request-scoped transactions](0045-relayed-writes-are-durable-intents-not-request-scoped-transactions.md)
- [ADR-0040 — Server-wallet transactions use a durable nonce allocator and outbox](0040-server-wallet-transactions-use-a-database-coordinated-dispatcher.md)
- `apps/backend/src/services/relayed-intents.ts`
- `apps/backend/src/services/relayed-intent-registry.ts`
- `apps/backend/src/routers/tasks.router.ts` — `contractAssignEvaluator`, the follow-on that surfaced this

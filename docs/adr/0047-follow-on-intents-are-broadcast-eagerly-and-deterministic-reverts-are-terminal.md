# 0047 — Follow-on intents are broadcast eagerly, and a deterministic revert is terminal

> **Decision (Y-statement):** In the context of a paid write being a chain of an observed
> payment transaction and a dispatched contract call, facing a follow-on delivery mechanism
> that deferred every second link to a background poll and retried permanent reverts forever,
> we decided to broadcast a follow-on immediately after its durable record is written and to
> mark a deterministically reverted follow-on `failed` without refunding, to achieve
> ADR-0046's durability guarantee at the timing the operations actually require, accepting
> that the worker becomes a crash-only fallback and that a chain can end permanently
> half-applied with no automatic compensation.

- **Status:** Proposed
- **Date:** 2026-08-03
- **Embodiment:** Not started
- **Last audited:** 2026-08-03
- **Author:** Claude Code (drafted for review)
- **Reviewers:** None recorded — drafted for review, no independent reviewer yet
- **Deciders:** (pending human approval)
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** —
- **Pending Amends / Amended-by:** Amends ADR-0045; amends ADR-0046

## Context

ADR-0045 and ADR-0046 built one thing between them, and neither says plainly what it is.

**What the mechanism actually is: a settlement layer that syncs the chain to the database.**
ADR-0045 is written around the refund defect it was fixing — a timeout being read as a
failure — and so describes the machinery as a fix for that bug rather than as the subject it
introduced. ADR-0046 then describes chaining as a workaround for one handler that needed a
second contract call. Both understate it. What exists is a layer that records intended on-chain
effects durably, watches the chain for what actually happened to them, and brings the database
into line with confirmed evidence — regardless of which process, request or restart is around
when the evidence arrives.

**A paid write is inherently a chain of two on-chain transactions.** Not sometimes; always,
and since long before either ADR:

1. **The x402 payment — observed, not dispatched.** USDC moves via `transferWithAuthorization`,
   broadcast by the external facilitator (`X402_FACILITATOR_URL`). We record its hash. We never
   send it and cannot replace it.
2. **The forwarded contract call — dispatched.** `createTask` and its peers, broadcast by our
   own server wallet through the forwarder, with a nonce we allocated.

That a link may be **observed rather than dispatched** is worth stating explicitly, because it
sounds like it should need special handling and does not. Settlement has never depended on
having sent a transaction, only on having confirmed evidence about one, so refund-against-root
already covers a root we merely watch: the payment either landed or it did not, and both
answers come from the chain either way.

`services/orphaned-payments.ts` and the `orphaned_payments` table are bespoke, hand-rolled
compensation for exactly this chain not being modelled: link one landed, link two did not,
reconcile it by hand. Its own table, its own retry script, two prior incidents behind it. That
is what chaining is for.

**ADR-0046's motivating example was the wrong one.** It presented evaluator assignment as the
case that forced chaining. `assignEvaluator` is simply another forwarded contract call, no
different in kind from the one before it, and architecturally uninteresting. It appears below
only as the concrete symptom that exposed the defect, not as a reason any of this exists.

Two things around ADR-0046's decision were wrong, and both were found in sandbox testing rather
than review.

**First, the delivery mechanism did not follow from the decision.** ADR-0046 says a handler must not
*broadcast*. Nothing in it says a follow-on must be broadcast *later*. The implementation
nevertheless left every follow-on to a background worker on a ~10 s poll, conflating durability
(the record exists before the transaction) with deferral (somebody else sends it later). Only
the first is load-bearing.

The consequence was immediate and total. `EvaluatorFacet.assignEvaluator` reverts with
`TaskNotOpen` unless the task is still `Open`, and worker agents claim tasks in milliseconds.
Before ADR-0046 the assignment ran in-request, milliseconds after the escrow receipt, and
landed. After it, the follow-on broadcast a poll interval later, by which time the task had
usually left `Open` and the call could never succeed. Sandbox evidence: 4 of 4 affected intents
sat at `status: recorded` carrying `TaskNotOpen`, retried on every pass forever. Evaluators
were silently never assigned, and nothing reported a failure, because nothing ever concluded
one.

**Second, the retry loop**, which is ADR-0040's lesson one layer up. `TaskNotOpen` is
not transient: the inputs and the on-chain state that produced it will not change by waiting.
ADR-0040 fixed the same class of mistake inside the relay path, where retrying a deterministic
revert burned nonces. The intent layer reintroduced it, with a worse symptom — an intent that
never reaches a terminal state is invisible to every alert that watches terminal states.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Broadcast a follow-on eagerly, immediately after its durable record is written; classify failures, and treat a deterministic revert as terminal (selected) | Restores pre-ADR-0046 timing for the common case, so status-gated calls land while their gate is still open; the durability guarantee is untouched, since the record is still written first; a permanent revert becomes a visible `failed` intent instead of an invisible infinite retry; the worker remains as a genuine crash fallback | A chain can end permanently half-applied with no automatic compensation; eager dispatch adds the follow-on's latency back onto the request |
| Keep the deferred worker, shorten the poll interval (rejected) | Smallest change; keeps one delivery path | Only narrows the race, never closes it: a worker agent can claim a task inside any interval, and the correct interval is zero, which is eager dispatch by another name |
| Keep the deferred worker, make `assignEvaluator` tolerate a non-`Open` task (rejected) | No backend change at all | Changes a contract's state machine to accommodate a backend scheduling choice; the gate exists because assigning an evaluator to an already-claimed task is genuinely wrong |
| Retry deterministic reverts with backoff instead of failing (rejected) | Never gives up on something that might have been misclassified | An answer that cannot change is not worth asking for repeatedly; it keeps the intent out of a terminal state, which is what made this defect silent |
| Refund the root when a follow-on fails deterministically (rejected) | Consistent-looking rule: "a failed chain refunds" | A double spend — see the Decision below |

## Decision

If accepted, ADR-0046's decision is unchanged in substance — a completion handler still
enqueues rather than broadcasts — and its delivery mechanism and failure handling are
corrected. ADR-0045's decision is likewise unchanged; what this amends there is its framing.

**The settlement layer is named as the subject, not as a bug fix.** ADR-0045 is the record that
owns this area, and it describes durable intents as the remedy for a refund defect. They are
the mechanism by which the chain and the database are kept in step at all, and a paid write is
a chain of an observed payment and a dispatched contract call whether or not anything is
currently going wrong. The Context above is the correction; nothing ADR-0045 decided moves.

**A follow-on is broadcast eagerly.** Once the durable record is written, the same context that
completed the parent broadcasts it, in-request where there is a request. Ordering is the entire
guarantee: record first, then send, exactly as a root intent does. Deferral was never required
by ADR-0046 and is removed.

**The worker is a crash and reconciler fallback only.** It picks up follow-ons that have sat
untouched past a grace window — a process that died between enqueuing and sending, or a link
handed back after a transient failure. It is no longer on the common path, and its poll
interval no longer bounds how quickly any operation completes.

**Failures are classified, and a deterministic revert is terminal.** A revert decoded from the
chain (the `KNOWN_ERRORS` vocabulary in `services/contract.ts`) marks the intent `failed` with
its reason. Provider timeouts, connection resets and throttling leave it `recorded` for retry.
An unrecognised error is treated as transient: inventing a terminal verdict would strand work a
retry would have finished, which is the more expensive of the two mistakes.

**A link may be observed rather than dispatched**, as the Context sets out, and settlement is
unchanged by which it is: refund-against-root already covers a root we only watch.

**A follow-on failure never refunds.** This is the one that needed arguing rather than asserting,
and ADR-0046's "a failed follow-on refunds against the root" was wrong.

Reaching a follow-on at all means its parent's transaction succeeded. For `tasks.create` that
parent is the escrow: it is on chain, mined, and the contract is holding the requester's USDC
against a task that genuinely exists and that workers can genuinely claim. Refunding the
requester from the server wallet while the contract still holds the same funds pays for one
task twice — precisely the double spend ADR-0045 exists to prevent, arrived at from the
opposite direction. What the requester is owed when `assignEvaluator` fails is the missing
effect, not their money; the intent row records exactly which link stopped and why, so it can
be pursued.

There is a second, independent reason in the deterministic case: the revert is caught at
simulation, before a nonce is spent, so there is no on-chain evidence of failure at all — and
ADR-0045's rule is that only confirmed on-chain evidence may settle. Neither the escrow nor the
follow-on offers any.

The refund rule therefore narrows: only a **root** intent's confirmed failure may refund, since
a root that failed bought nothing. `services/relayed-intent-settlement.ts` enforces this
directly rather than resolving the chain's root and refunding against it.

## Consequences

**Positive:**

- Evaluator assignment lands right after creation again, as it did before ADR-0046.
- A permanently impossible follow-on becomes a `failed` intent with a readable reason, visible
  to anything watching terminal states, instead of an unbounded retry nobody sees.
- One broadcast path serves the request, the reconciler and the worker, so a follow-on behaves
  identically whoever sends it.
- The escrow can no longer be refunded while it is still funded on chain.

**Negative / trade-offs:**

- A chain can end permanently half-applied — task created, evaluator never assigned — with no
  automatic compensation and no refund. This is a deliberate trade against double-spending; it
  needs alerting on `failed` non-root intents, which is now possible because they reach a
  terminal state at all.
- Eager dispatch puts the follow-on's latency back on the request, which is what it cost before
  ADR-0046.
- Classification is heuristic. It is deliberately biased towards `transient`, so the failure
  mode is a retried intent rather than a wrongly abandoned one.

**Neutral / follow-up:**

- **Explicitly not decided here, and not built here:** modelling the x402 payment as the root
  intent of every paid chain would let `orphaned_payments` collapse into the general "chain
  failed at link two, refund against root" path, replacing a bespoke table, a retry script and
  two incidents' worth of manual compensation with the mechanism that already exists. That is a
  substantially larger change and requires its own ADR. Committing to the machinery ahead of
  the need is the exact mistake this ADR is correcting, so it stays a named follow-up.
- Whether a failed follow-on should attempt compensating on-chain action remains out of scope,
  as ADR-0046 left it.
- The follow-on grace window is an operational constant, not a decision; it exists so eager
  dispatch and the worker cannot both spend a nonce on one link.

## References

- [ADR-0045 — Relayed writes are durable intents, not request-scoped transactions](0045-relayed-writes-are-durable-intents-not-request-scoped-transactions.md)
- [ADR-0046 — Relayed intents chain follow-on writes rather than relaying inside handlers](0046-relayed-intents-chain-follow-on-writes.md)
- [ADR-0040 — Server-wallet transactions use a durable nonce allocator and outbox](0040-server-wallet-transactions-use-a-database-coordinated-dispatcher.md)
- `apps/backend/src/lib/relay-failure.ts` — the deterministic/transient classification
- `apps/backend/src/services/relayed-intent-registry.ts` — the single eager broadcast path
- `apps/backend/src/services/relayed-intent-worker.ts` — reduced to a crash fallback
- `apps/backend/src/services/relayed-intent-settlement.ts` — the narrowed refund rule
- `apps/backend/src/services/orphaned-payments.ts` — the bespoke compensation the follow-up
  would replace
- `packages/contracts/src/facets/EvaluatorFacet.sol` — the `TaskNotOpen` gate on
  `assignEvaluator`

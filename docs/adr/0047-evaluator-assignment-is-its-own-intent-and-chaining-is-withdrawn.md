# 0047 — Evaluator assignment is its own intent, and the chaining subsystem is withdrawn

> **Decision (Y-statement):** In the context of a contract API that has no way to configure an
> evaluator at task creation, facing a chaining subsystem built to paper over the resulting
> second transaction and a live defect it caused, we decided to withdraw chaining entirely,
> broadcast each intent's transaction immediately after its durable record is written, treat a
> deterministic revert as terminal, and expose evaluator assignment as its own endpoint and its
> own root intent, to achieve one contract call per durable record with no unjustified
> abstraction, accepting that a requester whose task is claimed before they assign an evaluator
> cannot assign one at all until the contract API is changed.

- **Status:** Proposed
- **Date:** 2026-08-03
- **Embodiment:** Not started
- **Last audited:** 2026-08-03
- **Author:** Claude Code (drafted for review)
- **Reviewers:** None recorded — drafted for review, no independent reviewer yet
- **Deciders:** (pending human approval)
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** Supersedes ADR-0046
- **Amends / Amended-by:** —
- **Pending Amends / Amended-by:** Amends ADR-0045

## Context

The root cause of everything recorded here is a gap in the contract API. It is not a fact about
intents, chaining, or scheduling, and reading it as one is what produced the mistakes below.

**`createTask` cannot configure an evaluator.** `CoreFacet.createTask` takes reward, duration,
mode, pitch and bid deadlines, auction subtype, stake config, hook config and task content. It
takes no evaluator configuration of any kind. `EvaluatorFacet.assignEvaluator` is a separate
function, and it is gated: `if (task.status != ITMPCore.TaskStatus.Open) revert TaskNotOpen();`.

**That gate is correct.** Assigning an evaluator to a task a worker has already claimed changes
the terms after the worker committed to them — who judges the work, on what fee, on what
evaluation and appeal windows, with which dispute resolver. The contract is right to refuse.
Nothing in this ADR argues otherwise.

**The gap is that the API accepts evaluator fields at task creation while the contract does
not.** So the backend has to make two contract transactions for what the product presents as one
action, and the task becomes claimable the instant `createTask` mines. There is an unavoidable
window — real, however short — in which a worker can claim the task, after which the second call
can never succeed for that task. No backend arrangement closes that window; only a contract
change does.

Everything else followed from working around that gap, and the working-around went wrong twice.

**ADR-0046 built a subsystem for it.** It introduced parent links on intents, chain depth bounds,
cycle detection, root resolution, follow-on enqueueing from completion handlers, and a follow-on
worker — presenting evaluator assignment as the case that forced all of it. It was not that case.
`assignEvaluator` is an ordinary forwarded contract call. It moves no money of its own, carries no
payment reference, and needs no refund semantics. What it needed was for someone to call it
promptly. It got a generalised multi-transaction orchestration layer instead.

**Deferring the call then broke it in production-shaped testing.** ADR-0046 required only that a
completion handler must not *broadcast*; nothing in it required that follow-ons be broadcast
*later*. The implementation nevertheless handed every follow-on to a background worker on a ~10 s
poll, conflating durability (the record exists before the transaction) with deferral (somebody
else sends it later). Only the first was ever load-bearing. Before ADR-0046 the assignment ran in
the request, milliseconds after the escrow receipt, and landed. After it, the call fired a poll
interval later, by which time worker agents — which claim in milliseconds — had usually taken the
task. Sandbox evidence: 4 of 4 affected intents sat at `status: recorded` carrying `TaskNotOpen`,
retried on every pass forever. Evaluators were silently never assigned, and nothing reported a
failure because nothing ever concluded one. That retry loop is ADR-0040's lesson one layer up: a
deterministic revert re-asked on a timer is an answer that cannot change, and an intent that never
reaches a terminal state is invisible to every alert that watches terminal states.

**Chaining currently has no justified user.** Its two substantive benefits are refund-against-root
and ordering. Refund-against-root is irrelevant to a call that carries no payment — there is
nothing to refund. Ordering is achievable by simply not issuing the second request until the first
has completed, which is what a caller does anyway. The one genuine multi-transaction case in the
system is the x402 payment we observe followed by the forwarded contract call we dispatch, which
`services/orphaned-payments.ts` and the `orphaned_payments` table hand-roll compensation for. That
case is explicitly not being modelled yet (see follow-ups), so chaining today serves no case that
needs it.

The reasoning failure worth naming is not any individual step: it is that an abstraction was built
for one atypical case without anyone asking whether the case was representative. It was not, and
the case did not even need the abstraction.

ADR-0045's decision — durable intents, evidence-based settlement, idempotent completion — stands
and is not in question here. Its framing is referenced only as context: it describes durable
intents as a fix for a refund defect, when what they are is the layer that keeps the chain and the
database in step.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Withdraw chaining; one contract call is one root intent; broadcast eagerly; deterministic reverts terminal; evaluator assignment becomes its own endpoint (selected) | Removes a subsystem with no justified user, so there is less to reason about during an incident; restores pre-ADR-0046 timing, so the status-gated call lands while its gate is still open; a permanent revert becomes a visible `failed` intent instead of an invisible infinite retry; refunds narrow to intents that actually carry a payment | A requester whose task is claimed before assignment simply cannot assign an evaluator; deleting working code that a future case might have wanted; the create-then-assign window remains until the contract changes |
| Keep chaining as built (rejected) | No deletion; the machinery is written, tested and would be ready if a genuine multi-transaction case arrives | Maintaining parent links, depth bounds, cycle detection and root resolution for zero present users; its only motivating case never needed it; the code is a standing invitation to route future work through it because it exists, not because it fits |
| Keep the deferred worker, shorten the poll interval (rejected) | Smallest possible change; keeps one delivery path | Narrows the race, never closes it: a worker agent can claim inside any interval. The correct interval is zero, which is eager dispatch under another name |
| Relax the contract's `Open` gate on `assignEvaluator` (rejected) | No backend change at all; the second call would always succeed | Changes a contract state machine to accommodate a backend scheduling choice. The gate is substantively right — an evaluator appointed after a worker claims changes the terms the worker accepted. Bending a correct rule to fit an incorrect schedule is the wrong direction |
| Bundle evaluator configuration into `createTask` atomically (deferred, not rejected) | One transaction; the task is fully configured the instant it is live; the race disappears rather than being narrowed | `createTask` is part of the TMP spec surface (`ITMPCore`), so changing its signature may break the standard for other implementors; an additive function may be the right shape instead. That is a genuine design question and is not decided here |

## Decision

If accepted:

**1. ADR-0046 is superseded, and the chaining subsystem is withdrawn.** Parent links on intents,
chain depth bounds, cycle detection, root resolution, follow-on enqueueing from completion
handlers, and the follow-on worker's special-casing all go. **One contract call is one intent, and
every intent is a root.** A completion handler does database and notification work only, as
ADR-0045 specified before ADR-0046 widened it.

**2. An intent's transaction is broadcast immediately after its durable record is written.**
Record first, then send — that ordering is the entire durability guarantee, and it is preserved
exactly. The broadcast happens in the same context that created the record, in-request where
there is a request. The background worker remains as a crash fallback for records that have sat
untouched past a grace window, and is no longer on the common path, so its poll interval no longer
bounds how quickly any operation completes.

**3. A deterministic revert is terminal; transient failures retry.** A revert decoded from the
chain (the `KNOWN_ERRORS` vocabulary in `services/contract.ts`) marks the intent `failed` and
records the reason. Provider timeouts, connection resets and throttling leave it retryable. **An
unrecognised error is treated as transient**, deliberately: wrongly abandoning work a retry would
have finished is worse than retrying something that will never succeed, so the classification is
biased towards retry and the failure mode is a noisy intent rather than a lost one.

**4. Refunds are narrowed to intents that carry a payment.** An intent with no payment reference
has nothing to refund, so its failure never triggers one — this is definitional, not a policy
choice. The substantive part is what it rules out: refunding a requester because a *later,
separate* call failed. When `createTask` has mined, the escrow is on chain and the contract is
holding the requester's USDC against a task that genuinely exists and that workers can genuinely
claim. Paying the requester back from the server wallet while the contract still holds the same
funds pays for one task twice. That is the same double spend ADR-0045 exists to prevent, reached
from the opposite direction. What the requester is owed when evaluator assignment fails is the
missing effect, not their money; the failed intent records which call stopped and why. In the
deterministic case there is a second, independent reason: the revert is caught at simulation
before a nonce is spent, so there is no confirmed on-chain evidence of anything, and ADR-0045's
rule is that only confirmed on-chain evidence may settle.

**5. Evaluator assignment becomes its own API endpoint:** `POST /api/tasks/{id}/evaluator`. It
creates its own root intent, carries no payment, and chains to nothing. Task creation no longer
attempts a second contract call on the requester's behalf; a client that wants an evaluator calls
this endpoint after creation completes, which also gives it the ordering guarantee chaining was
supposed to provide, for free.

This endpoint is a **permanent feature, not a temporary workaround.** A requester who decides on
an evaluator after creating a task needs exactly this, and will still need it after the follow-up
below is resolved. It is constrained by the contract's `Open` gate — the task must not yet be
claimed — and that constraint is correct and stays.

## Consequences

**Positive:**

- A subsystem with no justified user is removed, and with it the parent/depth/cycle/root
  invariants that had to be enforced rather than assumed.
- Evaluator assignment lands promptly again, as it did before ADR-0046.
- A permanently impossible call becomes a `failed` intent with a readable reason, visible to
  anything watching terminal states, instead of an unbounded retry nobody sees.
- One broadcast path serves the request, the reconciler and the worker, so an intent behaves
  identically whoever sends it.
- An escrow can no longer be refunded while it is still funded on chain.
- Evaluator assignment becomes explicit in the API, so the two-transaction reality is visible to
  clients rather than hidden behind an atomic-looking create call.

**Negative / trade-offs:**

- A requester whose task is claimed between creation and assignment cannot assign an evaluator at
  all, and gets a `failed` intent saying so. This is not introduced here — assignment has always
  been a separate transaction and the race has always existed; ADR-0046 widened it from
  milliseconds to a poll interval, and this returns it to its prior width. It is not closed, and
  only the contract change below closes it.
- The API becomes two calls where it was one, which is more work for clients and one more state a
  client can leave a task in.
- Working code is deleted. If a genuine multi-transaction case arrives, chaining has to be built
  again — and should be, deliberately, for that case rather than retrofitted onto this one.
- A `failed` non-root — now simply a `failed` payment-less intent — only helps once something
  watches for it. Alerting on failed evaluator-assignment intents (a paid-for task left
  half-configured) is not built.

**Neutral / follow-up:**

- **Named follow-up, requiring its own ADR, explicitly not decided here: add evaluator
  configuration to task creation on the contract**, so the common case is a single transaction and
  the task is fully configured the instant it is live. The real design question is that
  `createTask` is part of the TMP spec surface (`ITMPCore`); changing its signature may break the
  standard for other implementors, and an additive function taking the evaluator config may be the
  right shape instead. That trade-off is not settled here and must not be settled by
  implementation. Until it is, `POST /api/tasks/{id}/evaluator` is how an evaluator is assigned.
- **Also a named follow-up, not decided here:** modelling the x402 payment as the root of a chain —
  an observed transaction we do not broadcast, followed by the forwarded call we do — would let
  `orphaned_payments` collapse into the general path, replacing a bespoke table, a retry script and
  two incidents' worth of manual compensation. That is the case that would genuinely justify
  chaining if it is ever rebuilt, and it needs its own ADR. Committing to the machinery ahead of
  the need is the exact mistake this ADR is correcting.
- Whether a failed assignment should attempt any compensating action remains out of scope, as
  ADR-0046 left it.
- The grace window before the crash-fallback worker touches an untouched record is an operational
  constant, not a decision; it exists so eager dispatch and the worker cannot both spend a nonce on
  one call.

## References

- [ADR-0045 — Relayed writes are durable intents, not request-scoped transactions](0045-relayed-writes-are-durable-intents-not-request-scoped-transactions.md)
- [ADR-0046 — Relayed intents chain follow-on writes rather than relaying inside handlers](0046-relayed-intents-chain-follow-on-writes.md)
- [ADR-0040 — Server-wallet transactions use a durable nonce allocator and outbox](0040-server-wallet-transactions-use-a-database-coordinated-dispatcher.md)
- `packages/contracts/src/facets/CoreFacet.sol` — `createTask`, which takes no evaluator config
- `packages/contracts/src/facets/EvaluatorFacet.sol` — `assignEvaluator` and its `TaskNotOpen` gate
- `apps/backend/src/lib/relay-failure.ts` — the deterministic/transient classification
- `apps/backend/src/services/relayed-intent-registry.ts` — the single eager broadcast path
- `apps/backend/src/services/relayed-intent-worker.ts` — reduced to a crash fallback
- `apps/backend/src/services/relayed-intent-settlement.ts` — the narrowed refund rule
- `apps/backend/src/services/orphaned-payments.ts` — the bespoke compensation the second follow-up
  would replace

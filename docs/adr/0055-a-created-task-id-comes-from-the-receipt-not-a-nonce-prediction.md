# 0055 — A created task's id comes from its receipt, not from a requester-nonce prediction

> **Decision (Y-statement):** In the context of task creation, whose contract-assigned id the
> backend predicted from a separately-read `requesterNonce` before broadcasting, facing two
> concurrent creates by one requester silently resolving to the same id and overwriting each
> other, we decided to take the id from the confirmed transaction's own `TaskCreated` log, to
> achieve an id that is stated by the chain rather than guessed about it, accepting that the id
> is not knowable until the receipt arrives and so cannot be returned by a request that ends
> before one does.

- **Status:** Accepted
- **Date:** 2026-08-03
- **Embodiment:** Verified
- **Last audited:** 2026-08-03
- **Author:** Claude Code (drafted for review)
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** —
- **Pending Amends / Amended-by:** Pending amends ADR-0045; pending amends ADR-0050

## Context

`CoreFacet.createTask` derives the id it assigns as

```solidity
taskId = keccak256(abi.encode(block.chainid, address(this), requester, s.requesterNonce[requester]++));
```

The backend reproduced that formula in `precomputeTaskId`, reading `requesterNonce(requester)`
in an RPC call of its own before broadcasting, and carried the resulting id in the
`tasks.create` intent payload.

The formula was right. The nonce was not. It is read in one transaction-less call and consumed
in another, and the contract increments it as part of deriving the id — so anything else by the
same requester landing in between shifts the real id off the prediction. Two things follow, and
the second needs no rebroadcast and no reconciler to reach:

1. **A rebroadcast could name a different task.** This is why `tasks.create` was the one
   safely-replayable operation left without a broadcaster when ADR-0050's rebroadcast path was
   built. The exclusion was correct given the prediction, and it was the only thing keeping the
   design from being uniform.

2. **Two concurrent creates by one requester corrupt each other.** Both read nonce N, both
   predict `id(N)`, the chain assigns N and N+1. The second intent persists the *first* task's
   id, and `completeTasksCreate`'s `onConflictDoUpdate` — which exists so the chain-event
   indexer may win the insert race — then overwrites that task's description, reward, tags,
   visibility and deadlines with the second request's values. The requester paid for two tasks,
   owns one, and it describes work they did not ask for at that price.

Nothing serializes this. ADR-0040's dispatcher states in as many words that concurrent
transactions may be in flight at different nonces and that throughput is not serialized, and no
per-requester lock exists anywhere on the create path. An agent creating two tasks at once is an
ordinary thing to do.

The nonce smoke never caught it because it created its tasks in an awaited loop, which makes the
interleave impossible and the prediction always right.

ADR-0045 already draws the relevant distinction everywhere else. `acceptance.rate` re-reads its
block number from the receipt and `evaluations.evaluate` its block timestamp, both precisely
because the payload predates the transaction. The task id is the same kind of fact and was the
one place still guessed at.

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| Read the id from the transaction's own `TaskCreated` log (selected) | The chain states the id rather than us guessing it, so no concurrent write can invalidate it; re-derivable from the hash alone, so a reconciler pass an hour later reads exactly what the request would have; removes the last obstacle to a `tasks.create` broadcaster; one rule shared with every other receipt-derived field | The id does not exist until the receipt does, so a request that returns early cannot report one; the create response and the intent payload both change; a second receipt read on the happy path |
| Serialize creates per requester with an advisory lock (rejected) | Keeps the prediction and the early id, so no client contract changes | Fixes only the local case. It does nothing for a rebroadcast, which lands outside any request's lock, and nothing for a second backend process or a create relayed by anything else. It also buys correctness with a lock held across an RPC call and a chain broadcast, which is the shape ADR-0040 went out of its way to remove |
| Reserve the id by pre-incrementing the nonce on chain (rejected) | Prediction becomes true by construction | A second transaction, and therefore a second gas cost and a second failure mode, per creation — to learn something the first transaction already tells us |
| Keep the prediction and accept the race (rejected) | No work | The corruption is silent, is reachable from two ordinary requests, and destroys a paid-for task. It is also the reason a whole operation is missing from a mechanism otherwise described as universal |

The rejected advisory-lock option deserves naming because it is the tempting one: it is small and
it makes the failing case pass. It is rejected because it defends a guess instead of removing
it, and a guess that is defended in one place is a guess that will be made somewhere else.

## Decision

**1. The id is read from the receipt.** `taskIdForTx` decodes the `TaskCreated` log out of the
confirmed transaction, filtered to logs emitted by the TaskMarket contract itself — a
requester-controlled hook runs in the same transaction and can emit a byte-identical forged log,
and a forged id would attach the entire creation to a task of the attacker's choosing. It is the
same filter, for the same reason, as `decodeTaskCompletedLogs`. A confirmed transaction with no
such log yields no id and no row: there is none to invent.

**2. The intent payload identifies the operation, never its result.** `TasksCreateIntentPayload`
carries neither the task id nor the escrow hash. Both are facts about a transaction that does not
exist when the row is written, and both reach the completion as arguments from whichever of the
request or the reconciler observed the receipt. This is what `completeAcceptanceRate` already
does with `blockNumberForTx`.

**3. Everything that was keyed on the early id is keyed on something that exists.** The task-drop
reservation, which must be taken before the chain call because it is what stops a concurrent
creation consuming the same drop slot, gets an identifier of its own rather than borrowing the
task's. The evaluator-assignment follow-on derives its idempotency key from the resolved id,
which is stable across completion attempts because the same hash always decodes to the same id.

**4. The response is honest about what is known.** `POST /api/tasks` returns the resolved
`taskId` and the intent id on every response it returns, because every response it returns is one
whose escrow has confirmed. A request whose receipt does not arrive in time returns no id at all:
it raises the in-flight error every relayed write raises, and the id genuinely is not known —
the transaction may still be replaced at the same nonce, in which case no task was ever created.
Returning a predicted id there would be the original defect wearing a new hat. That caller's
durable handle is the idempotency key they generated (ADR-0052); `intents.get` answers on it and
reports the task id once the intent completes (ADR-0049).

**5. `tasks.create` gains a broadcaster.** The exclusion existed only because of the prediction,
so removing the prediction removes the exclusion. The guard a second landing relies on is the
forwarder's own: `TaskMarketForwarder.relay` records `consumedReceipts[receiptHash]` over
(chainId, pgtrSender, paymentAmount, receiptNonce, validBefore, taskMarket, selector) and reverts
`ReceiptAlreadyConsumed` on a repeat. Every one of those is immutable across attempts, because a
rebroadcast replays the intent's stored envelope verbatim (ADR-0050 point 7). So a retry of a
creation that did in fact land reverts on chain rather than escrowing a second reward. The
request path and the sweep call one shared builder, so the two cannot drift apart.

**6. The indexer race is untouched.** `processTaskCreatedEvent` still inserts a row for the same
id from the same event, and `completeTasksCreate` still upserts. What changes is that the id both
sides write is now derived from the same transaction, so the conflict they resolve is the one the
upsert was written for — a task row racing its own completion — and never two different tasks
colliding on one id.

## Consequences

**Positive:**

- Two concurrent creates by one requester produce two tasks. Neither overwrites the other.
- Every relayed write that can be safely replayed now has a broadcaster; the mechanism ADR-0050
  describes is uniform rather than uniform-with-one-exception.
- A late-completing creation writes the id the chain actually assigned, not the one the request
  guessed hours earlier.
- One rule covers every receipt-derived field, so the next one needs no argument.

**Negative / trade-offs:**

- A request that ends before its receipt has no task id to return. This is a real loss for a
  caller who wanted one synchronously, and it is the honest answer rather than a new one.
- The happy path reads the receipt twice, once in the completion and once for the response.
- `intents.get` gains a task lookup, joining on the escrow hash, so the intent surface now
  touches the tasks table.

**Neutral / follow-up:**

- The smoke that was best placed to catch this now creates two tasks from one requester
  concurrently, and asserts both the ids and the persisted descriptions are distinct. Distinct
  ids alone would not have caught the overwrite.
- Whether `POST /api/tasks` should return a structured in-flight result rather than an error, as
  ADR-0049 point 3 requires of every paid write, is unchanged and still outstanding. This
  decision does not settle it; it only stops that path returning a value it does not know.

## References

- [ADR-0045 — Relayed writes are durable intents, not request-scoped transactions](0045-relayed-writes-are-durable-intents-not-request-scoped-transactions.md)
- [ADR-0049 — In-flight paid writes are observable through a dedicated intent status surface](0049-in-flight-paid-writes-are-observable-through-a-dedicated-intent-status-surface.md)
- [ADR-0050 — Durable writes follow the chain call, and unbroadcast intents are retried before refund](0050-durable-writes-follow-the-chain-call-and-unbroadcast-intents-are-retried-before-refund.md)
- [ADR-0052 — Every relayed write carries a client-generated idempotency key](0052-every-relayed-write-carries-a-client-generated-idempotency-key.md)
- `packages/contracts/src/facets/CoreFacet.sol` — derives the id from `s.requesterNonce[requester]++`
- `packages/contracts/src/TaskMarketForwarder.sol` — `consumedReceipts`, the guard a second landing hits
- `apps/backend/src/services/contract.ts` — `taskIdForTx`
- `apps/backend/src/services/intents/tasks-create-intent.ts` — the payload, the completion and the broadcaster

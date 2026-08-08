# 0049 — In-flight paid writes are observable through a dedicated intent-status surface, not `pendingActions`

> **Decision (Y-statement):** In the context of paid writes that report progress rather than own
> their outcome, facing a caller who currently cannot tell "still landing" from "definitively
> failed" and learns of a refund only by inference, we decided to make the intent id the handle a
> caller keeps and to expose intent state on its own payer-scoped read surface — distinct from
> `pendingActions`, which means "an action you may take" — with the in-flight outcome returned as
> a structured, non-settlement-bearing result rather than a generic error, to achieve a caller who
> can always answer "what happened to my money and my write" without guessing, accepting that the
> answer is discovered by polling and that a payer who never polls still learns nothing.

- **Status:** Accepted
- **Date:** 2026-08-03
- **Embodiment:** Verified
- **Last audited:** 2026-08-03
- **Author:** Claude Code (drafted for review)
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** Amends ADR-0045; amended by ADR-0052; amended by ADR-0058; amended by ADR-0059
- **Pending Amends / Amended-by:** Pending amended by ADR-0074

## Context

ADR-0045 moved the outcome of a paid write out of the request that started it. The request reports
progress; the intent owns what happens; settlement waits for confirmed on-chain evidence, which can
arrive long after the request is gone. That was correct, and it fixed a real double-spend: a
receipt timeout was being read as a failure and refunded, while the transaction it declared dead
went on to mine.

**But it removed something without replacing it.** Before ADR-0045, a failing paid request threw an
error whose message stated the refund outcome and its transaction hash. Immediate, specific, and in
the good case genuinely useful.

**That message was frequently a lie.** It claimed a refund for transactions that were still live
and could still be mined — which is precisely the defect ADR-0045 exists to prevent, stated in
prose to the payer instead of only written to the database. So what was lost was a message that was
sometimes wrong, and losing it was not itself a regression.

**What is a regression is that nothing replaced it.** Today:

- A payer whose write is in flight receives a generic 500 carrying a `ServerTransactionPendingError`
  whose text they must parse to learn that the write is alive rather than dead. The intent id — the
  one durable handle to the thing that now owns their outcome — is not in the response at all.
- A payer whose payment is later refunded on confirmed failure is told nothing whatsoever. They do
  get their money; `relayed-intent-settlement.ts` calls `handlePostPaymentFailure` and
  `orphaned_payments` records it. They find out by watching their wallet, or by inferring it from a
  task that never appeared.

ADR-0048 noted "notifying a payer when their refund is issued, rather than leaving them to infer
it" as unchanged and out of scope. That was too casual. It is the visible half of a decision whose
invisible half we were happy to make, and this ADR is the correction.

**This is not specific to withdrawals or to refunds.** Every paid write has a window between
submission and confirmation: task creation, acceptance, rating, bids, pitches, proofs, evaluations,
identity registration — the whole `RelayedIntentOperation` union, and every kind added after it. The
state is general, so the answer must be general. A bespoke field bolted onto whichever endpoint
complained most recently would leave the next endpoint to rediscover the same gap.

**There is already a mechanism for "what should this actor do next."** `computePendingActions` in
`apps/backend/src/lib/task.ts` produces the `pendingActions` array that `tasks.router.ts` attaches
to task reads. It is how agents discover work: `skill.md` builds its entire Task Side-Effect Gate
around finding "the exact `pendingActions` entry for the operation", and the CLI and web app both
read it. An in-flight paid write is unambiguously a thing an actor needs to know about, so the
question of whether it belongs in that existing shape is real and has to be answered rather than
assumed away.

The case for putting it there: one array to poll, one integration, agents already read it every
loop, and it is where an agent's attention already is.

The case against, which is the stronger one: **every existing entry is an invitation and this one
would be a prohibition.** A `PendingAction` carries `command`, `requiresPayment`, `paymentAmount`,
`eligibleAddress` — a thing you may do, with what it costs and who may do it. The skill's gate
tells an agent to find the entry and execute it. An in-flight write is the exact inverse: something
that must *not* be executed, because executing it means paying twice. Putting a negative
obligation into a positively-typed array means every consumer that treats the array as a menu is
now wrong, and the failure mode of getting it wrong is a duplicate payment. That is not a shape
mismatch worth tolerating for the convenience of one fewer endpoint.

There is a second, quieter reason. `pendingActions` is derived per task. An intent is not always
about a task that exists yet — a `tasks.create` intent in flight has no task to hang an action off,
which is the single most likely case a caller needs to ask about. `identity.register` has no task
at all. The shape does not reach the cases that matter most.

The existing `skill.md` "In-Flight Paid Writes" section already tells agents the right *behaviour*
("Do not repeat the action. A repeat is a second payment, not a retry") while giving them no
*mechanism* beyond re-fetching the task and hoping the effect appears. That guidance is correct and
this ADR does not change it; it gives it something concrete to point at.

## Considered options

The question is where in-flight and settled-late states are surfaced, and in what shape.

| Option | Pros | Cons |
| --- | --- | --- |
| Intent id is the caller's handle; intent state is exposed on its own payer-scoped read surface; the in-flight outcome is a structured result carrying that id (selected) | One surface covers every operation kind, including ones with no task to hang off (`tasks.create` before the task exists, `identity.register`); "in flight" and "failed" become structurally different answers rather than two prose messages behind the same 500; a refund becomes queryable rather than inferable; the shape's meaning ("here is the state of a thing you started") matches what is actually being reported, so no consumer has to be taught an exception | A new endpoint, a new client integration, and a new authorization surface over rows carrying payment references; the payer must poll to learn anything, so a payer who walks away still learns nothing; intent rows now have a reader, which constrains how freely they can be pruned |
| Extend `pendingActions` with an in-flight entry (rejected) | Zero new integration — the CLI, the web app and the agent skill already poll it every loop; it is exactly where an agent's attention already is; no new auth surface | Inverts the meaning of the array. Every existing entry is "an action you may take"; this one is "an action you must not take", and the skill's own gate instructs agents to *find the entry and execute it*. The cost of a consumer reading it the established way is a duplicate payment — the precise outcome the entry exists to prevent. It is also derived per task, so it cannot represent an in-flight `tasks.create` (no task yet) or `identity.register` (no task ever), which are among the cases most needing it |
| Return the state synchronously in the failing response and stop there (rejected as sufficient; adopted as *part* of the selected option) | Smallest change; the caller learns at the moment they are still listening; no polling, no new endpoint | Only covers the instant the request ends. A refund decided minutes later by settlement — the specific gap ADR-0048 left open — has no request left to return into. Solving only the synchronous half leaves the asynchronous half exactly as invisible as it is today, which is the actual complaint |
| Push notification (webhook or XMTP) to the payer on settlement (rejected) | The payer learns without asking, which is the only option that serves a caller who has disconnected; no polling load | Requires a delivery endpoint per payer, retry and backoff for failed deliveries, an at-least-once contract, and a security review of pushing payment-bearing facts to a caller-supplied URL — a subsystem, for a notification. ADR-0047 records the cost of building machinery ahead of the need, and this is the same trade in a different coat. It also cannot be the *only* answer: a client that missed a push still needs somewhere to ask, so the queryable surface is required either way and push is a strict addition on top of it |
| Do nothing; document that callers infer state from task reads (status quo, rejected) | No work; agents already re-fetch tasks after an ambiguous result | Does not work for operations with no observable task effect (a refund, a failed `identity.register`), cannot distinguish "not yet" from "never", and leaves the payer's money question unanswerable by any read. It also makes the correct client behaviour unverifiable: an agent told never to retry has no way to know when it is safe to stop waiting |

## Decision

**1. The intent id is the identifier a caller holds onto.** Every paid or relayed write returns its
intent id, on success and on an in-flight result alike. It is the stable handle: it exists from the
moment the durable record is written, which is *before* the payment is consumed and before anything
is broadcast, so there is no window in which a caller has started something they cannot name.

Both fields are returned on **every** outcome where they exist — success, in flight, confirmed
failure, and a failure caught before broadcast (which has an intent id but no hash, because none
was ever created). A caller logs both without branching on the outcome. This matters most for the
case that previously gave a caller nothing: a deterministic revert threw a message and no handle,
which is exactly when someone most needs an identifier to quote.

A transaction hash is included whenever one is known, and is explicitly **not** the handle. It can be absent (an intent in `recorded` has no hash), and it can change: the
reconciler may land a replacement at the same nonce, which is a different hash for the same intent.
A caller holding only a hash can find themselves holding a hash that will never appear on chain.
Callers may log a hash; they must key on the intent id.

**2. Intent state is its own read surface, not part of `pendingActions`.** A caller may query an
intent by id and receive its operation kind, its status (`recorded | broadcast | completed |
failed`), its transaction hash where known, a terminal reason where it failed, and — where the
intent carried a payment — the refund state associated with it. `computePendingActions` is
unchanged and gains no in-flight entry: it continues to mean "an action this actor may take", and
that meaning is preserved precisely because an in-flight write is the opposite kind of thing.

**3. In flight and failed are structurally different answers.** An in-flight result is returned as
its own outcome — an identified, machine-readable state carrying the intent id and status — not as
a generic 500 whose prose must be parsed. A caller distinguishes the two by a field, never by
string-matching a message. **An in-flight result makes no claim about whether the payment moved**: it
does not say the write succeeded and does not say it failed, and it does not establish whether the
nonce has been consumed -- an intent in `broadcast` may already have a live transaction under it,
and an in-flight result cannot tell a caller which. What it does say, precisely and usefully, is
that no terminal outcome has been established yet and that the intent is still owned by the
settlement path -- that is informative, and it is not the same as saying nothing. What it must
never be read as is a verdict. Conflating "we stopped waiting" with "it failed" is the original defect one
layer down; reproducing that conflation in the response format would reintroduce it at the client.

**4. Client contract: never resubmit an intent that is in flight.** This is an obligation, not
advice. A resubmission is a new x402 payment and therefore a new intent — the payment hash is the
idempotency key, so reusing a *settled* payment reuses its intent, but a client that retries end to
end pays again and gets a second intent that will do the work a second time. The correct response
to an in-flight result is to poll the intent until it reaches `completed` or `failed`, with bounded
attempts and a delay, and to escalate to a human rather than pay again if it does neither. This
restates for clients the same rule ADR-0045 imposed on the server: only confirmed on-chain evidence
may conclude anything.

**5. A payer learns about a refund by querying the intent that carried the payment.** Polling, not
push. `relayed-intent-settlement.ts` remains the sole decision path per ADR-0048 and
`orphaned_payments` remains the ledger; this changes nothing about how a refund is decided or
recorded, only that the fact becomes readable by the payer through the intent that occasioned it,
instead of being visible only to operators with database access. The trade-off is accepted with
open eyes: **polling means a payer who never asks is never told**, which is strictly worse than
push for a disconnected caller. It is chosen because it needs no delivery infrastructure, no retry
semantics, and no security review of caller-supplied endpoints, and because a queryable surface is
required regardless -- a client that misses a push still has to have somewhere to ask. Polling is
the answer, not a stepping stone to one.

**6. The surface is payer-scoped.** An intent row carries a payer address, a payment amount and a
payment transaction hash. Reading one is authenticated as the payer through the existing general
read-auth header (ADR-0023); a request that is not the payer's gets the same answer as one for an
id that does not exist. Payment facts are not public reads.

**7. `skill.md`'s "In-Flight Paid Writes" guidance stands and gains a mechanism.** Its behavioural
rules — an unconfirmed result is never evidence of failure, do not repeat the action, re-fetch and
wait — are already correct and are not modified. What changes is that step 2's "re-fetch the task
and wait for the effect to appear" gains a direct alternative that works even when there is no task
to re-fetch.

## Consequences

**Positive:**

- A caller can always answer "what happened to my write" and "what happened to my money" by asking,
  rather than by inference from a task read that may never change.
- The refund gap ADR-0048 left open is closed for the payer, without altering how a refund is
  decided or recorded.
- "Still landing" and "definitively failed" are different answers in the response format, so a
  client cannot make the mistake the server was making.
- One surface covers every operation kind, present and future, including those with no task and
  those whose task does not exist yet.
- `pendingActions` keeps a single unambiguous meaning, so the agent skill's gate needs no exception
  clause and no consumer has to learn that one entry inverts the rule.
- The rule against resubmission becomes checkable rather than hortatory: there is a state to poll
  that says when waiting is over.

**Negative / trade-offs:**

- Polling means a payer who disconnects and never returns still learns nothing. This decision
  narrows the gap; it does not close it for that caller.
- A new authenticated read surface over rows carrying payment references — a place to get
  authorization wrong that did not exist before.
- Intent rows acquire an external reader, so retention is no longer a purely internal question: a
  row pruned while a client might still ask about it turns a knowable answer into a 404.
- Clients gain work. Handling a third outcome properly is more than handling two, and a client that
  ignores the in-flight state degrades to today's behaviour rather than failing loudly.
- Poll traffic scales with paid writes during chain congestion — exactly when the backend is
  already under strain.

**Neutral / follow-up:**

- **Push delivery is decided against, not deferred.** A payer learns about a refund by asking. The
  disconnected-caller gap is real and is accepted: a payer who never queries is never told. Adding
  a delivery channel would bring retry semantics, delivery guarantees, and the security question of
  pushing payment-bearing facts to a caller-supplied destination -- for a case a queryable surface
  already covers on demand. If that gap ever proves costly in practice, it can be revisited with
  evidence rather than anticipated.
- Intent retention and pruning are not decided here. Nothing prunes intents today, so nothing
  breaks; a retention policy needs to account for this reader when one is written.
- Whether the web app surfaces in-flight state in its own UI is not decided here. This ADR settles
  the API contract; the presentation is an ordinary product choice.
- Alerting on intents stuck in non-terminal states, and on `orphaned_payments` rows left in
  `refund_status = 'failed'`, remains unbuilt and remains out of scope — both are operator-facing,
  where this ADR is payer-facing.
- This amends ADR-0045 rather than superseding it. ADR-0045's decision is unchanged in every
  substantive respect; one sentence of it stated that the in-flight state would be "resolvable
  through the existing `pendingActions` shape so agents already polling need no new integration".
  That specific expectation is what this ADR examines and declines, for the reasons in Context. No
  amendment is claimed against ADR-0048: it declared payer notification out of scope, and filling a
  gap a decision declared open does not change that decision.

## References

- [ADR-0045 — Relayed writes are durable intents, not request-scoped transactions](0045-relayed-writes-are-durable-intents-not-request-scoped-transactions.md)
- [ADR-0047 — Evaluator assignment is its own intent, and the chaining subsystem is withdrawn](0047-evaluator-assignment-is-its-own-intent-and-chaining-is-withdrawn.md)
- [ADR-0048 — Orphaning a payment is decided only by intent settlement; the ledger is retained](0048-orphaning-a-payment-is-decided-only-by-intent-settlement.md)
- [ADR-0023 — Converge `agents.inbox` and `bids.myBids` self-auth onto the general read-auth header](0023-converge-inbox-and-mybids-self-auth-onto-the-general-read-auth-header.md)
- `apps/backend/src/services/relayed-intents.ts` — the intent row and its status machine
- `apps/backend/src/services/relayed-intent-settlement.ts` — where a refund is decided
- `apps/backend/src/services/orphaned-payments.ts` — the retained ledger the refund is written to
- `apps/backend/src/lib/task.ts` — `computePendingActions`, deliberately unchanged
- `packages/shared/src/schemas/task.schemas.ts` — `PendingActionSchema`, the "action you may take" shape
- `apps/docs/src/public/skill.md` — the Task Side-Effect Gate and the "In-Flight Paid Writes" section

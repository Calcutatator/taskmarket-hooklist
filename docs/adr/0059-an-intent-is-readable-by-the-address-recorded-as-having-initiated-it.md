# 0059 — An intent is readable by the address recorded as having initiated it

> **Decision (Y-statement):** In the context of relayed writes whose intent rows record who the
> relay acted for, facing an `intents.get` surface that answers "no such intent" to the very
> caller who started a free write, we decided that an intent is visible to the address recorded
> as its initiator — one comparison, with no branch on whether a payment exists — rather than
> adding a second, participant-based rule for the payer-less case, to achieve ADR-0049's promise
> that a caller can always ask what happened to their write without giving a single-rule
> authorization surface a second rule to drift from, accepting that an intent with no recorded
> initiator is readable by nobody and that a caller who identifies themselves on a
> permissionless endpoint gets an answer their anonymous neighbour does not.

- **Status:** Proposed
- **Date:** 2026-08-04
- **Embodiment:** Verified
- **Last audited:** 2026-08-04
- **Author:** Claude Code (drafted for review)
- **Reviewers:** (none recorded)
- **Deciders:** (pending)
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** —
- **Pending Amends / Amended-by:** Pending Amends ADR-0049

**This document was rewritten after review of an earlier accepted draft that was never
implemented.** That draft — same number, titled "An intent with no payer is readable by a
participant of the task it concerns" — proposed scoping payer-less intents to task participants.
It was accepted, then corrected minutes later in the same conversation by the same decider,
before any code was written. It is recorded below in Considered options as a rejected
alternative, with the reason, rather than being preserved as a superseded document: a
supersession chain for a decision that never shipped obscures the history it is meant to keep.
`Status` is back to `Proposed` and `Deciders` is pending; nothing here has been decided yet.

## Context

ADR-0049 built `intents.get` to answer "what happened to my write, and what happened to my
money", and point 6 scoped it to the payer: an intent row carries a payer address, an amount and
a payment transaction hash, so reading one is reading someone's payment facts.

`intentVisibleTo` in `apps/backend/src/routers/intents.router.ts` implements that literally:

```ts
if (!intent.payer) return false;
```

An intent with no payer is therefore visible to nobody at all — not even to the caller who
started it. The rows exist, record exactly what happened, and are queryable only from a database
console.

**Payer-less intents are not hypothetical.** `evaluations.finalizeVerdict` is permissionless by
design — anyone may push a task past an expired appeal window — and its router records no payer,
because there is no payment and it never asked who was calling. Every such write produces a row
that is written and then permanently unreadable through the surface built for reading it.

There is a sharper consequence. ADR-0058 makes every relayed write answer an in-flight result
with `reason: 'intent_in_flight'` and an intent id, and instructs the client to poll
`intents.get` rather than resubmit. For a free write that instruction is currently unfollowable:
the client is handed a handle and told to use it on a surface that will always answer "no such
intent". A client that cannot poll and is told not to resubmit has nothing left to do.

**The question this ADR answers is what rule closes that gap, not whether it should be closed.**
The gap is agreed. What matters is that `intents.get` today asks one question — "is the caller
the address on this row" — and any fix that answers it with a *different* question for some rows
gives the surface two authorization rules where it had one. Two rules for one question is how
they drift apart and how a gap opens between them; ADR-0049 already named its single rule as "a
place to get authorization wrong that did not exist before", and a second one is a second such
place.

**There is a convergence that makes one rule sufficient.** ADR-0057 moved payment into its own
indivisible `IntentPaymentReference`. Since then, `relayed_intents.payer` is no longer the field
that makes an intent refundable — the presence of `payment` is — and the input type's own doc
comment already says so: "Who the relay acted for. Recorded for provenance on every path, paid
or not." That column is the initiator, under an older name. Scoping visibility on it is not a
new concept bolted onto the surface; it is the concept the surface was already comparing
against, stated accurately.

What the existing call sites already record confirms it. Of the relayed writes in the routers,
every one that records an address records the address that started the write: the settled x402
payer where the route is paid, and the signature-verified actor (`input.workerAddress`,
`input.requesterAddress`, `input.from`) where the route authenticates by signature instead. The
one route that records nothing is the one permissionless route. There is no path where the
recorded address is a bystander.

## Considered options

The question is **what single fact `intents.get` authorizes against**.

| Option | Pros | Cons |
| --- | --- | --- |
| An intent is visible to the address recorded as having initiated it, populated on every path including the permissionless one where the caller identified themselves (selected) | One comparison, one rule, no branch on whether a payment exists — the surface keeps exactly the number of authorization rules ADR-0049 gave it; the fact it compares against is already stored and already means this, so nothing new is derived or inferred at read time; the rule is stable under new operations, because "who started this" is a question every relayed write can answer, whereas "which task does this concern" is not; a permissionless endpoint stays permissionless, since identifying yourself buys a later read and is never required to call | An intent with no recorded initiator is readable by nobody, and on the permissionless path that is the caller's own choice made at a moment they may not realize matters; two callers making the same permissionless call get different read access afterwards, which is a real asymmetry even though it is one each of them controls |
| A payer-less intent is readable by a participant of the task named in its payload (rejected — this ADR's own earlier accepted draft) | Reaches a requester or worker who wants to know a free write happened on their task without having made it; participants are an established authorization concept here with an existing mechanism (ADR-0023) | **Adds a second authorization rule to a surface deliberately built with one.** The paid case would ask "are you the address on this row" and the free case "are you a participant of the task in this payload" — two rules answering one question, which is how they drift apart and how a gap opens between them. It also reads a task id out of an untyped payload, so a payload shape change narrows visibility silently instead of failing; it does not reach an operation that concerns no task; and it grants a read to parties who did not make the write, which is broader than the promise ADR-0049 actually made, that a caller can always answer what happened to *their* write |
| Leave it: payer-less intents stay unreadable (rejected) | No new authorization surface at all; already shipped and already reasoned about in a code comment | Leaves ADR-0049's central promise false for an entire class of write, and ADR-0058's "poll, do not resubmit" instruction unfollowable for exactly those writes. "Operators read them from the database" is not an answer to a caller, and the caller is who the surface is for |
| Make payer-less intents public (rejected) | Trivial; the rows carry no payment facts, so the disclosure is genuinely small | Small is not nothing: the row names an operation, a task, a transaction hash, a failure reason and a timeline. It also makes the rule "public unless paid", which is a rule someone will later extend to a row that acquired a payer after the fact |
| Add a second `initiator` column beside `payer`, rather than reusing it (rejected) | Names the two ideas separately, so a future path where the refund destination and the initiator genuinely differ could record both | There is no such path today, and on every current call site the two are the same address. A second column would be written from the same value everywhere, giving two fields to keep consistent and a silent failure mode when a later call site fills in only one. Payment already has its own indivisible reference (ADR-0057), so the residual column is free to mean one thing |

## Decision

**1. `intentVisibleTo` is one comparison.** An intent is visible to the address recorded on it as
having initiated the write, and to nobody else. There is no branch on whether a payment exists.

**2. The initiator is recorded on every path, and what it is depends only on how the caller was
authenticated:**

- **Paid write** — the settled x402 payer. Unchanged behaviour; this is what every paid route
  already records, and it is the address a refund goes to, so the reader of an intent's payment
  facts remains the person whose money they are.
- **Signature-authenticated write** — the verified signer. Also unchanged; the routes that
  authenticate by signature already record the address they verified.
- **Permissionless write** — the caller's address when they supplied the ADR-0023 read-auth
  headers, and nothing otherwise. The endpoint stays permissionless: nobody has to identify
  themselves in order to *call* it. Identifying yourself is how you earn the ability to *ask
  about it later*.

**3. An intent with no recorded initiator is readable by nobody.** Not a fallback rule and not a
gap — it is the honest answer to "who started this" when nothing was recorded, and inventing a
reader for it would be inventing the second rule this ADR exists to avoid.

**4. A caller who is not the initiator gets `intent_not_found`, the same answer as for an id that
does not exist** (ADR-0058's reason code). "Not yours" and "no such thing" stay
indistinguishable, so the surface does not become an oracle for which intent ids and idempotency
keys exist.

**5. The `payer` column keeps its name, and its documentation is corrected to say what it holds.**
Renaming it to `initiator` was considered and declined: the column is read by
`relayed-intent-settlement.ts` as the destination a refund is transferred to, so a rename would
leave the money path reading a field called `initiator` to decide where to send money — the more
dangerous of the two available misnamings. The column genuinely holds both facts, and they are
the same address on every path, because the address that pays is the address that started the
write. What was actually misleading was the documentation, which is fixed rather than worked
around.

## Consequences

**Positive:**

- ADR-0049's promise becomes true for every relayed write rather than for paid ones only, and it
  does so without `intents.get` gaining a second authorization rule.
- ADR-0058's client contract — poll the intent, never resubmit — becomes followable on free
  writes, which is where a resubmission is cheapest to attempt and therefore most likely.
- The rule is stated in terms of a fact every relayed write has, so a new operation kind needs no
  new visibility reasoning. The rejected participant rule would have needed a fresh answer for
  the first operation that concerns no task.
- Nothing is derived at read time. The rule compares a stored column, so no payload shape change
  can silently widen or narrow who can read a row.

**Negative / trade-offs:**

- A permissionless caller who sends no read-auth headers cannot later ask about the write they
  made, and the moment that decides it is the moment they call, before they know they will need
  to ask. The in-flight envelope still returns them the intent id, which is then a handle to
  something they cannot query.
- Two callers making the identical permissionless call end up with different read access
  afterwards. That asymmetry is each caller's own choice, but it is still an asymmetry in what
  the endpoint gives back.
- A task requester cannot see, through this surface, that someone finalized a verdict on their
  task. That information remains derivable from the task's own state, which is where it was
  before; this ADR deliberately does not open a second door to it.
- `relayed_intents.payer` continues to carry two meanings under one name. Point 5 argues the name
  is the safer of the two available, not that it is a good name.

**Neutral / follow-up:**

- Whether the permissionless routes should *require* read-auth headers, rather than merely
  rewarding them, is not decided here. Requiring them would end the asymmetry above and would
  also stop the endpoint being permissionless, which is a change to ADR-0026's posture and
  belongs in its own decision if anyone wants it.
- Nothing changes about how a refund is decided or recorded. ADR-0048 and ADR-0057 stand exactly
  as written; this ADR only reads the column they populate.
- This amends ADR-0049 rather than superseding it. Point 6's payer scoping is unchanged in
  substance for every intent that has a payer — which is every intent ADR-0049 was reasoning
  about — and is restated in terms of the fact it was always comparing.

## References

- [ADR-0023 — Converge `agents.inbox` and `bids.myBids` self-auth onto the general read-auth header](0023-converge-inbox-and-mybids-self-auth-onto-the-general-read-auth-header.md)
- [ADR-0026 — refundExpired is callable by anyone, not just the requester](0026-refund-expired-is-permissionless.md)
- [ADR-0048 — Orphaning a payment is decided only by intent settlement; the ledger is retained](0048-orphaning-a-payment-is-decided-only-by-intent-settlement.md)
- [ADR-0049 — In-flight paid writes are observable through a dedicated intent-status surface](0049-in-flight-paid-writes-are-observable-through-a-dedicated-intent-status-surface.md)
- [ADR-0057 — A settled payment is one indivisible reference, published by the middleware that settled it](0057-a-settled-payment-is-one-indivisible-reference-published-by-the-middleware.md)
- [ADR-0058 — Every API error carries a machine-readable reason](0058-every-api-error-carries-a-machine-readable-reason.md)
- `apps/backend/src/routers/intents.router.ts` — `intentVisibleTo`, the rule this restates
- `apps/backend/src/routers/evaluations.router.ts` — `finalizeVerdict`, the one permissionless
  write, which records an initiator only when the caller identified themselves
- `apps/backend/src/services/relayed-intent-settlement.ts` — reads the same column as a refund
  destination, which is why point 5 declines the rename

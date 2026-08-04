# 0059 — An intent with no payer is readable by a participant of the task it concerns

> **Decision (Y-statement):** In the context of relayed writes that carry no payment and therefore
> no payer, facing an `intents.get` surface that denies them to everyone including the caller who
> started them, we decided to scope a payer-less intent to the participants of the task it names
> rather than leaving it unreadable, to achieve ADR-0049's promise that a caller can always ask
> what happened to their write, accepting that this introduces a second authorization rule on a
> surface deliberately built with one.

- **Status:** Accepted
- **Date:** 2026-08-04
- **Embodiment:** Not started
- **Last audited:** 2026-08-04
- **Author:** Claude Code (drafted for review)
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** Amends ADR-0049
- **Pending Amends / Amended-by:** —

## Context

ADR-0049 built `intents.get` to answer "what happened to my write, and what happened to my money",
and point 6 scoped it to the payer: an intent row carries a payer address, an amount and a payment
transaction hash, so reading one is reading someone's payment facts.

`intentVisibleTo` in `apps/backend/src/routers/intents.router.ts` implements that literally:

```ts
if (!intent.payer) return false;
```

An intent with no payer is therefore visible to nobody at all. Not to the caller who started it,
not to the requester or worker of the task it concerns, not to anyone with an address to prove.
The rows exist, record exactly what happened, and are queryable only from a database console.

**Payer-less intents are not hypothetical.** `evaluations.finalizeVerdict` is permissionless by
design — anyone may push a task past an expired appeal window — and its router records no payer,
because there is no meaningful one to record. Every such write produces a row that is written and
then permanently unreadable through the surface built for reading it.

The router's own comment is honest about this and treats it as deliberate: "rather than invent one
those rows are readable by nobody through this surface. Operators read them from the database,
which is where they were readable before." That reasoning holds for *who owns the money*, because
there is none. It does not hold for *who is entitled to know the write happened*.

ADR-0049 was written about a payer's money. Its promise — "a caller can always answer 'what
happened to my write'" — was stated in general terms and then implemented with an authorization
rule that only reaches paid writes, because the case it was arguing about was a refund. That is a
gap between the decision's stated aim and its stated mechanism, not a second decision the ADR made
and we now disagree with.

There is a second, sharper consequence. ADR-0058 makes every relayed write answer an in-flight
result with `reason: 'intent_in_flight'` and an intent id, and instructs the client to poll
`intents.get` rather than resubmit. For a free write that instruction is currently unfollowable:
the client is handed a handle and told to use it on a surface that will always answer "no such
intent". A client that cannot poll and is told not to resubmit has nothing left to do.

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| A payer-less intent is readable by a participant of the task named in its payload (selected) | Follows ADR-0049's aim rather than only its wording; every payer-less operation today concerns exactly one task, and its participants are already an established authorization concept in this codebase with an existing read-auth mechanism (ADR-0023); makes the in-flight poll instruction followable for free writes; discloses nothing about money, because there is none on these rows | A second authorization rule on a surface deliberately built with one, and a second place to get authorization wrong; requires reading a task id out of an untyped intent payload; a payer-less operation added later that concerns no task falls outside it and needs its own answer |
| Leave it: payer-less intents stay unreadable (rejected) | No new authorization surface; the smallest possible attack surface on rows that reference payments; already shipped and already reasoned about in a comment | Leaves ADR-0049's central promise false for an entire class of write, and leaves ADR-0058's "poll, do not resubmit" instruction unfollowable for exactly those writes. "Operators read them from the database" is not an answer to a caller, and the caller is who the surface is for |
| Make payer-less intents public (rejected) | Trivial; the rows carry no payment facts, so the disclosure is genuinely small | Small is not nothing: the row names an operation, a task, a transaction hash, a failure reason and a timeline. It also makes the surface's authorization rule "public unless paid", which is a rule someone will later extend to a row that acquired a payer after the fact |
| Record a synthetic payer on free writes — the caller's address as a stand-in (rejected) | One authorization rule everywhere; no payload reading | Overloads the column that settlement reads. `payer` is the address a refund is sent to, and `settleAbandonedIntents` keys on the presence of payment facts; putting a non-paying address there invites exactly the class of confusion ADR-0057 removed by making a payment one indivisible reference. It also does not exist for a genuinely permissionless write, where there is no caller identity to record |

## Decision

**1. `intentVisibleTo` gains a second branch, not a replacement.** An intent with a payer stays
payer-scoped exactly as ADR-0049 decided; nothing about a paid intent's visibility changes.

**2. An intent with no payer is visible to a participant of the task its payload names** —
requester, selected worker, or assigned evaluator — authenticated through the general read-auth
header (ADR-0023), the same mechanism every other self-scoped read on this backend uses.

**3. An intent with no payer and no resolvable task stays visible to nobody.** No payer-less
operation is in that position today. If one is added, it gets its own answer rather than a default
that quietly widens this one.

**4. A caller who is not entitled gets the `intent_not_found` answer, unchanged.** "Not yours" and
"no such thing" remain indistinguishable, so this surface does not become an oracle for which
intent ids and idempotency keys exist.

## Consequences

**Positive:**

- ADR-0049's promise becomes true for every relayed write rather than for paid ones only.
- ADR-0058's client contract — poll the intent, never resubmit — becomes followable on free
  writes, which is where a resubmission is cheapest to attempt and therefore most likely.
- The rows stop being operator-only for a class of write that has no operator-only reason to be.

**Negative / trade-offs:**

- A second authorization rule on a surface whose single rule was itself listed by ADR-0049 as "a
  place to get authorization wrong that did not exist before". This is a second such place.
- It reads a task id out of an intent payload, which is stored untyped. A payload shape change
  would silently narrow visibility back to nobody rather than failing loudly.
- Task participation is broader than "the caller who made the write". A requester can see that
  someone finalized a verdict on their task, which is information they could already derive from
  the task's own state, but through a new door.

**Neutral / follow-up:**

- Not built. This ADR is `Proposed` and `intentVisibleTo` is unchanged; the code carries a comment
  pointing here so the gap is documented at the place it exists rather than only in this file.
- Whether the participant set should be narrower — the worker only, say, for a worker-initiated
  free write — is deliberately left open. Every payer-less operation today is either
  permissionless or worker-initiated, and drawing the line finer than "participant" needs a case
  that distinguishes them.
- This amends ADR-0049 rather than superseding it. Point 6's payer scoping is unchanged for every
  intent that has a payer, which is every intent ADR-0049 was reasoning about.

## References

- [ADR-0049 — In-flight paid writes are observable through a dedicated intent-status surface](0049-in-flight-paid-writes-are-observable-through-a-dedicated-intent-status-surface.md)
- [ADR-0023 — Converge `agents.inbox` and `bids.myBids` self-auth onto the general read-auth header](0023-converge-inbox-and-mybids-self-auth-onto-the-general-read-auth-header.md)
- [ADR-0058 — Every API error carries a machine-readable reason](0058-every-api-error-carries-a-machine-readable-reason.md)
- `apps/backend/src/routers/intents.router.ts` — `intentVisibleTo`, the rule this would extend
- `apps/backend/src/routers/evaluations.router.ts` — `finalizeVerdict`, the permissionless write that records no payer

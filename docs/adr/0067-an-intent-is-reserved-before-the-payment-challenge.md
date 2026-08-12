# 0067 — An intent is reserved when the request arrives, before the payment challenge

> **Decision (Y-statement):** In the context of a relayed write that must be charged for exactly
> once, facing an idempotency check that reads before the payment settles and therefore cannot stop
> two concurrent requests from both being charged, we decided to create the intent as a reservation
> when the request arrives — claiming the idempotency key atomically before any 402 challenge — and
> attach the settled payment to it afterwards, to achieve exactly-once charging by construction
> rather than by cleanup, accepting a new pre-payment lifecycle state that needs its own expiry.

- **Status:** Accepted
- **Date:** 2026-08-05
- **Accepted:** 2026-08-05
- **Embodiment:** Verified
- **Last audited:** 2026-08-05
- **Author:** Claude Code (drafted for review)
- **Reviewers:** Beau Williams — self-attested; no independent reviewer recorded
- **Deciders:** Beau Williams
- **Supersedes / Superseded-by:** —
- **Amends / Amended-by:** Amends ADR-0045, Amends ADR-0052; amended by ADR-0068

## Context

ADR-0052 made every relayed write carry a client-generated idempotency key. ADR-0045 made the write
a durable intent recorded before the chain call. Both hold. What neither settles is *when the key is
claimed*, and the current answer is: too late.

The order today is

1. the middleware **reads** whether the key already names an intent, before issuing the 402
   challenge, so a repeat is refused without being charged;
2. the x402 facilitator **settles the payment**;
3. the handler **creates the intent**, carrying the settled payment reference.

Step 1 is a read and step 3 is the write, so between them there is a window. Two concurrent
requests with the same key both find nothing at step 1, both are challenged, and both settle a
payment. Step 3 then correctly refuses the second — after its money has moved. The idempotency key
did its job at the layer that has it, and the charge happened at a layer that did not.

This is not a client fault. A retry carrying the same key is exactly the behaviour idempotency keys
exist to make safe, and a sequential retry is handled correctly: it finds the recorded intent and
is deduplicated. Only a concurrent retry races. The window is narrow and the loss is silent, which
is a bad combination — the worst path does not even throw, because two requests with matching
payloads take the "return the existing intent" branch and the second payment simply has nothing
pointing at it.

A second problem falls out of the same ordering. Because the intent is created after settlement,
the absence of a payment reference currently carries exactly one meaning: this was a free
operation. `claims.claim`, `submissions.submit`, `forfeit` and the permissionless
`finalizeVerdict` all create intents with null payment columns, and the schema comment states the
rule plainly — it is the presence of `payment_tx_hash` and `payment_amount` that makes an intent
refundable. If intents start being created before payment, that same absence acquires a second,
opposite meaning: a paid operation whose payment has not landed yet. A sweep reading the first
meaning on the second case treats a pending payment as a free write and never reconciles it.

## Considered options

| Option | Pros | Cons |
| ------ | ---- | ---- |
| **A. Reserve the intent at request time, before the challenge; attach payment on settlement** (chosen) | Closes the race by construction — the second concurrent request loses the claim and is refused *before* being asked to pay, so there is no second payment to refund or record; makes the intent what it was always meant to be, the reservation; keeps one mechanism instead of a check plus a cleanup | Introduces a pre-payment state that can be abandoned and therefore needs expiry; requires a flag distinguishing "free" from "not paid yet", which is a schema change and a migration; unauthenticated callers can create rows |
| B. Keep the read-check, add a lock around key + settlement (rejected) | No lifecycle change; no migration | A lock spanning an external settlement call is a lock held across a network boundary with a facilitator on the other end. Its failure mode is a stuck key rather than a double charge, which is better, but it is a new distributed-locking concern in exchange for avoiding a state the model arguably should have had anyway |
| C. Accept the race and reconcile afterwards (rejected — current behaviour plus the defect-3 fix) | Smallest change; the unattached payment is at least recorded and recoverable | Recording is not preventing. The caller is still charged twice for behaving correctly, and someone has to make them whole. Recovery machinery for a case that can be made impossible is machinery that will rot |
| D. Make settlement itself idempotent on our key (rejected) | Would fix it at the layer where the money moves | The facilitator settles an EIP-3009 authorization and knows nothing about our idempotency key. Not ours to change, and it would couple charging to a protocol detail we do not control |

## Decision

The intent is created when the request arrives, before any payment challenge, and creating it
**claims the idempotency key atomically**. A second request presenting a claimed key is refused at
that point — before the 402 — so it is never charged.

The settled payment is attached to the already-reserved intent rather than supplied at creation.
An intent therefore has an explicit notion of whether payment is required, so that three states are
distinguishable rather than two:

- payment not required, none present — a free relayed write, correct and terminal;
- payment required, none present — **reserved, awaiting settlement**;
- payment required and present — paid, ready to broadcast.

The middle state is new and is the one that needs bounding. A reserved intent that is never filled
expires after a TTL and is swept.

**A reservation is never expired without first establishing that no payment landed against it.**
Time alone is not evidence. A reservation can be abandoned for two reasons that look identical
after the fact — the caller received its challenge and walked away, or the caller paid and the
process died between settlement and attachment — and only the first is garbage. Expiring the second
discards a settled payment.

To make that check deterministic rather than a search, **the reservation records the authorization
it is about to settle, before asking the facilitator to settle it.**

The obvious approach — having the 402 challenge dictate the EIP-3009 `nonce` so a settled payment
names its own reservation — was investigated and does not work. x402's payment requirements carry
no nonce field: `accepts[]` specifies scheme, network, amount, asset, `payTo`, timeout and the
EIP-712 domain, and nothing else. The client generates the nonce at random, and the requirements
sent to the facilitator for verification omit it, so the facilitator compares amount, asset and
recipient but never the nonce. A required nonce could be smuggled through the free-form `extra`
field, but only clients that chose to honour it would, and nothing would enforce it — which makes
it a convention, not a construction.

What does work is one step earlier. The middleware already holds the full authorization — nonce,
payer and amount — at the moment it posts `{ paymentPayload, paymentRequirements }` to the
facilitator. The binding exists; it is simply not durable. So the reservation records that
authorization **before** the settle call rather than after it returns.

A process that dies mid-settlement then leaves a reservation that already names the exact
authorization, and the sweep can ask a precise question about that specific nonce instead of
inferring from payer and amount. This is the same move ADR-0045 made for chain calls — record
before the irreversible step — applied one layer further out, and it requires no protocol change,
no facilitator change and no client cooperation, which is what makes it enforceable rather than
advisory.

The unattached-payment record (ADR-0048's recording path) remains as the backstop for anything that
still slips through, but under this decision it should stop being reachable by ordinary
concurrency.

## Consequences

**Positive:**

- A correctly-retried request cannot be charged twice, rather than being charged twice and made
  whole afterwards.
- The intent becomes the reservation, which is what the name always implied and what a reader
  reasonably assumes it already is.
- The overloading of "no payment reference" is removed, so free writes and unpaid-but-pending
  writes stop being indistinguishable to every sweep that looks at them.
- The unattached-payment recorder narrows to genuine infrastructure failure, instead of also
  absorbing an ordinary concurrency race.
- Recording the authorization before settlement makes every settled payment attributable to exactly
  one intent. Reconciling a payment stops being a search and becomes a lookup, which is what turns
  expiry from a risk into a safe operation.
- The write-ahead record is useful beyond expiry: it gives operations a durable answer to "what was
  this payment for" for every settled payment, not only abandoned ones.

**Negative / trade-offs:**

- A new lifecycle state, and every sweep, status projection and client-facing status mapping has to
  account for it. A state that exists but is unhandled somewhere is how the original overloading
  arose.
- A schema change and therefore a migration, with the journal-timestamp discipline that carries.
- The pre-402 path writes to the database, where it previously only read. An unauthenticated caller
  can create reservation rows, so the TTL is load-bearing rather than housekeeping, and the write
  is a cheap denial-of-service surface that rate limiting has to cover.
- The window between reservation and settlement is a period in which an intent exists for work
  nobody has paid for. It must never be broadcastable in that state, and that guard is now the
  thing standing between a reservation and free execution of a paid operation.
- The write-ahead record adds a database write on the paid path, before an external call that is
  already the slowest step. The cost is small relative to settlement, but it is on the hot path.
- A recorded authorization that never settles — the facilitator rejects it, or the client abandons
  after signing — leaves a row describing a payment that does not exist. It must be readable as
  "attempted", never as evidence that money moved.

**Neutral / follow-up:**

- The client-facing contract does not change. A reused key is still refused; it is refused earlier
  and without a charge.
- ADR-0057's indivisible payment reference is unaffected: the reference is still attached as one
  unit, just later than creation.
- Whether an expired reservation is deleted or retained as an audit row is an implementation
  choice this decision does not fix.

## References

- `docs/adr/0045-a-relayed-write-is-a-durable-intent.md` — recording before the chain call, amended
  here to recording before the payment.
- `docs/adr/0052-every-relayed-write-carries-a-client-generated-idempotency-key.md` — the key this
  decision changes the claim timing of.
- `docs/adr/0057-a-settled-payment-is-one-indivisible-reference-published-by-the-middleware.md` —
  unchanged; the reference is attached later, not split.
- `docs/adr/0048-refund-decisions-belong-to-intent-settlement.md` — why the unattached-payment
  record does not itself refund.

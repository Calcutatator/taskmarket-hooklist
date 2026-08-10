# 0068 — The idempotency key is claimed before settlement, not before the challenge

> **Decision (Y-statement):** In the context of charging for a relayed write exactly once, facing a
> claim placed before the 402 challenge that cannot tell an exchange's own second round from a
> competing request and so refuses the paying client, we decided to claim the key on the round that
> carries payment rather than on the round that asks for a price, to achieve exactly-once charging
> without breaking the two-round exchange it protects, accepting that a client racing itself is
> refused a moment later, after signing an authorization it will not use.

- **Status:** Accepted
- **Date:** 2026-08-05
- **Embodiment:** Verified
- **Last audited:** 2026-08-05
- **Author:** Claude Code (drafted for review)
- **Reviewers:** Beau Williams — self-attested; no independent reviewer recorded
- **Deciders:** Beau Williams
- **Supersedes / Superseded-by:** —
- **Amends / Amended-by:** Amends ADR-0067

## Context

ADR-0067 closed a real defect: the idempotency check read before the payment settled, so two
concurrent requests with one key were both charged. Its remedy was to claim the key atomically, and
it placed that claim **before any 402 challenge**.

That placement is stronger than the argument for it, and the extra strength is what broke.

x402 is a two-round exchange. Round one arrives with no payment and is answered with a price.
Round two arrives with a signed authorization **carrying the same idempotency key**, because it is
the same logical write. With the claim placed on round one, round two finds a live `reserved` row
under its own key, cannot distinguish itself from a competing request, and is refused `409
idempotency_key_reused`. Takeover does not help: it requires the reservation to have expired, and
the TTL is ten minutes.

So every paid write was refused on the round that pays for it, for the length of the TTL. The
reservation tests asserted that two concurrent requests produced `[402, 409]` rather than
`[402, 402]`, which is correct for a race — and identical, from the reservation's point of view, to
the legitimate second round nobody wrote a test for.

The underlying mistake is about who is on the other end. A client mints its own key, so two
requests carrying one key are one client sending twice, not two parties competing. What ADR-0067
protects against is a client accidentally paying twice for one operation — and a client can only
pay on a round that carries payment.

## Considered options

| Option | Pros | Cons |
| ------ | ---- | ---- |
| **A. Claim on the round that carries payment** (chosen) | Settlement only happens on that round, so an atomic claim there still gives exactly-once charging; the exchange's own second round is no longer indistinguishable from a competitor because there is nothing to collide with; round one stops writing to the database, which removes the unauthenticated-write surface and makes the TTL housekeeping rather than load-bearing; the claim-to-settle window gets shorter | A client racing itself is refused one round later, after signing an authorization it will not use. The signature is unused and expires |
| B. Keep the pre-challenge claim, and let a payment-bearing request continue an existing reservation (rejected) | Preserves ADR-0067's wording; refuses a duplicate at the earliest possible moment | Reopens the defect it was written to close. Two concurrent *second* rounds would both continue the same reservation and both settle, which is the double charge, arriving by a longer road |
| C. Keep the pre-challenge claim and bind the reservation to the caller (rejected) | Would distinguish the exchange's own round from another | There is nothing to bind to. Round one carries no payment payload and, on these routes, no authenticated caller — the key is the only identifier, and it is exactly what the second round also presents |
| D. Release the reservation before returning the challenge (rejected) | One-line change; unblocks the exchange | Equivalent to having no claim at all. Two concurrent first rounds would both be challenged, both sign, and both settle |

## Decision

The idempotency key is claimed on the round that carries a payment, immediately before settlement,
rather than on the round that asks for a price.

A request with no payment is answered with a 402 and writes nothing. The key is still **validated**
there — a missing or malformed key is still rejected before the challenge, as ADR-0052 requires, so
nothing is charged on a request that could never have been idempotent. Validation is not a claim.

ADR-0067 stands in every other respect: the claim is atomic and database-arbitrated, the settled
payment attaches to the claimed row, `payment_required` still separates a free write from one whose
payment has not landed, the authorization is still recorded before the settle call, and a
reservation that is never filled still expires without being assumed dead.

## Consequences

**Positive:**

- The two-round exchange works, which it did not.
- Exactly-once charging is preserved, and by a shorter argument: settlement happens on one round,
  and that round claims before it settles.
- Round one no longer writes, so an unauthenticated caller cannot create rows. The rate-limiting
  concern ADR-0067 raised against that surface goes away rather than being mitigated.
- The window between claim and settlement narrows to a single request, so a reservation is
  abandoned only by a process dying mid-settlement rather than by any client that walks away after
  being quoted a price.

**Negative / trade-offs:**

- A client that races itself signs an authorization that is then refused. Nothing is charged and
  the signature expires unused, but it is wasted work the earlier placement would have avoided.
- A duplicate is detected later, so the answer arrives after a round trip rather than before one.

**Neutral / follow-up:**

- The TTL and its sweep remain. They now cover only the case where settlement was attempted and the
  process died, which is the case the write-ahead authorization record was built for.
- No schema change. `reserved` remains a status, and the columns ADR-0067 added are unchanged.
- The test that asserted `[402, 409]` for two concurrent requests is still right about a race. What
  was missing, and is added here, is a test that an exchange's own second round proceeds.

## References

- `docs/adr/0067-an-intent-is-reserved-before-the-payment-challenge.md` — the decision amended
  here.
- `docs/adr/0052-every-relayed-write-carries-a-client-generated-idempotency-key.md` — key
  validation before the challenge, which is unchanged.
- `apps/backend/src/middleware/x402.ts` — where the claim is placed.
- `apps/backend/src/services/relayed-intents.ts` — `reserveRelayedWrite`.

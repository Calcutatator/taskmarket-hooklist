# 0035 — Submission metering bypasses x402Middleware entirely rather than pricing free submissions at zero

> **Decision (Y-statement):** In the context of metering bounty/benchmark submissions per
> `(worker, task)` under RFC-0006, facing the fact that a zero-value `transferWithAuthorization`
> is a technically valid x402 payment signature, we decided to bypass `x402Middleware` entirely
> for submissions within the free allowance rather than price them at zero to achieve no wasted
> facilitator round-trip or gas for a payment that settles nothing, accepting a second code path
> (bypass vs. paid) instead of one middleware invoked uniformly with a variable amount.

- **Status:** Accepted
- **Date:** 2026-07-31
- **Embodiment:** Verified
- **Last audited:** 2026-07-31
- **Author:** Beau (drafted by Claude Code from already-shipped implementation, for review)
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —
- **Amends / Amended-by:** —

## Context

RFC-0006 (`docs/rfc/0006-submission-spam-free-allowance-pricing.md`) proposes metering bounty/
benchmark submissions: the first N successful submissions from a worker to a task are free, every
submission after that costs the standard 0.001 USDC x402 relay fee. This ADR records the specific
mechanism decision the RFC's own Proposal section already argued for, now implemented and tested,
not a new option being weighed from scratch.

`x402Middleware` (`apps/backend/src/middleware/x402.ts`) already supports dynamic, per-request
pricing — `getAmount` is typed `(req) => string | Promise<string>` and is awaited, with the
`update` route already resolving its price from the database. The middleware demands a payment
signature unconditionally; there is no zero-amount short-circuit. A zero-value
`transferWithAuthorization` is a valid signature a worker's wallet can produce with no USDC
balance, so pricing the free tier at `0` would work functionally — but settling it still costs a
real facilitator round-trip and on-chain gas for a payment that transfers nothing.

Separately: `workerAddress` is unauthenticated at middleware time (signature verification happens
later, in `submissions.router.ts`), so whatever determines "is this worker within their free
allowance" must not be derivable from an unauthenticated request field, or an attacker could burn
another worker's allowance by spamming with a spoofed address.

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| **Bypass `x402Middleware` entirely for free submissions** (chosen) | No facilitator round-trip or gas cost for a payment that settles nothing; a worker with zero USDC balance can still submit within the allowance | A second code path exists (bypass vs. paid) rather than one middleware invocation with a variable amount; `res.locals.payer` is unset on the free path, so downstream code must not read it |
| Price the free tier at `0` USDC via the existing dynamic-`getAmount` pattern (rejected) | Single code path — `x402Middleware` handles both free and paid uniformly, matching the `update` route's existing dynamic-pricing precedent exactly | Still requires the worker to sign and submit a real `transferWithAuthorization`, still costs a facilitator round-trip and real gas to settle a transfer of nothing — defeats the actual goal (avoid wasted cost, not just avoid charging the worker) |
| Count allowance from middleware request attempts, either option above (rejected) | Simpler — no need to query the `submissions` table before deciding | `workerAddress` is unauthenticated at middleware time; an attacker could spam a spoofed address to burn a real worker's allowance before that worker ever submits |

## Decision

The free tier bypasses `x402Middleware` entirely rather than pricing at zero, and the allowance
count is read from the `submissions` table (successful, on-chain-confirmed submissions only) —
never from middleware-level attempt counts — specifically because `workerAddress` is not yet
authenticated at that point in the request lifecycle.

## Consequences

**Positive:**

- Zero facilitator round-trip or gas cost for submissions within the free allowance — the actual
  goal, not just "the worker doesn't pay."
- A worker with no USDC balance can use the full free allowance, matching the on-ramp goal RFC-0006
  states directly.
- The allowance-burning spoofing hole is closed by construction: reading the count, not writing
  anything, from an unauthenticated field can at most let an attacker see another worker's count,
  never consume it.

**Negative / trade-offs:**

- Two code paths exist for submission requests (bypass vs. `x402Middleware`) instead of one
  middleware invocation handling both uniformly, unlike the `update` route's existing
  dynamic-`getAmount` pattern.
- `res.locals.payer` is unset for free submissions; any future code added to
  `submissions.router.ts` (or a route composed with this middleware) must keep deriving worker
  identity from the verified signature, never from `payer` — this ADR is the place that
  requirement is now recorded, not just a comment in the router.

**Neutral / follow-up:**

- This holds only while `TaskMarketForwarder.authorizedRelayer` remains a single immutable
  address (per RFC-0006's own Motivation section) — if a second relayer is ever authorized, backend
  metering silently degrades from a guarantee to a suggestion. Out of scope for this ADR; flagged
  here so it isn't lost if that constraint ever changes.
- Task-lookup failure inside the gate fails open to unmetered (`next()`), not to the paid path —
  this route had no x402 gate at all before RFC-0006, so an internal error should not silently
  start charging a worker for something that used to be free. A normal implementation default, not
  a re-litigated part of this decision.

## References

- RFC: `docs/rfc/0006-submission-spam-free-allowance-pricing.md`
- `apps/backend/src/middleware/submissionAllowanceGate.ts`
- `apps/backend/src/services/submission-allowance.ts`
- `apps/backend/src/middleware/x402.ts`
- `apps/backend/src/app.ts` (route wiring)

# 0076 — A first send is bounded by an absolute fee ceiling, not by a multiple of the oracle

> **Decision (Y-statement):** In the context of a first send that prices itself at twice whatever
> `estimateFeesPerGas` returns, facing a sandbox run whose relayer wallet paid 5,716 ETH because
> each send raised the base fee that priced the next one, we decided to apply an absolute per-gas
> ceiling to every send rather than only to replacements, to achieve a bound that holds when the
> oracle itself is wrong, accepting that the ceiling is unset by default and therefore protects
> only deployments that configure it.

- **Status:** Accepted
- **Date:** 2026-08-08
- **Accepted:** 2026-08-08
- **Embodiment:** Verified
- **Last audited:** `[unaudited]`
- **Author:** Claude Code (drafted for review)
- **Deciders:** Beau
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** Amends ADR-0051
- **Pending Amends / Amended-by:** —

## Context

`getGasParams` prices every first send as `estimateFeesPerGas() * GAS_MULTIPLIER`, where
`GAS_MULTIPLIER = 2n`. There is no ceiling of any kind on the result.

ADR-0051 gave the *replacement* path a full escalation policy: a geometric bump under
`REPLACEMENT_GAS_MAX_MULTIPLE`, plus an optional absolute per-gas ceiling in
`REPLACEMENT_GAS_MAX_FEE_WEI`. That decision was about a transaction already stuck, and it bounded
it carefully. The first send — the one every paid write makes — was left with no bound at all. The
asymmetry was never decided; it is what happens when one path gets a policy and its sibling does
not.

A sandbox run made the gap visible. `make smoke rate-limit` drained the relayer wallet of **5,716
ETH**, against 0.001–0.017 ETH for every other target. Outbox nonces 175–195 were all fresh sends
(`attempts=0`, so not the replacement path), and their fee doubled roughly every 1.06s from 16 gwei
to 16,777,216 gwei. Nonce 195 mined at that price: 170,362 gas for one submission, 2,858 ETH. The
geometric sum matches the measured drain to within 0.2 ETH.

The mechanism is a feedback loop, and it is the important part: **our own send raises the base fee
that the next send's oracle reads.** `estimateFeesPerGas` returns a figure derived from recent
blocks; doubling it and broadcasting pushes the next block's base fee up; the next call reads the
inflated figure and doubles again. Nothing in the loop is a bug on its own. The doubling is
deliberate, the oracle is honest, and the chain is behaving correctly.

Two facts bound how much this generalises, and both should be stated plainly:

- **It is substantially an Anvil artifact.** The sandbox runs `--block-time 1` with our
  transactions as essentially the only traffic, so we dominate the fee market completely. On Base
  our sends are a rounding error in the base fee and cannot move it, so the loop does not close.
- **The amplification mechanism is inferred, not captured.** The reviewer who found this said so
  explicitly, having already had one plausible explanation for this failure turn out to be wrong.
  No raw JSON-RPC capture exists. This ADR does not depend on the mechanism being exactly right --
  it depends only on there being no bound, which is directly observable in the source.

What survives the caveats is the thing worth deciding: **a first send has no upper bound on what it
will pay, and the one bound we do have is on the other path.** The drain was fake; the missing
ceiling is not.

## Considered options

| Option | Pros | Cons |
| ------ | ---- | ---- |
| **Apply `REPLACEMENT_GAS_MAX_FEE_WEI` to every send, clamping rather than refusing** (chosen) | Closes the asymmetry with the knob that already exists and already means "never pay more than this per gas" -- no second concept, no second name for one quantity. Clamping keeps the write alive: an under-priced transaction sits in the mempool and the replacement path (ADR-0051) escalates it, which is a recoverable outcome, where an overspend is not | Unset by default, so a deployment that configures nothing is exactly as unbounded as it is today. The knob's own comment explains why there is no default: a wei value means nothing without knowing the chain |
| Leave first sends unbounded (rejected) | No change. The observed drain cannot happen on Base, where we cannot move the base fee | Leaves a money path with no upper bound because the only environment that exposed it was artificial. The next fee regime that surprises us gets doubled and sent with nothing to say no |
| Refuse to send above the ceiling instead of clamping (rejected) | Never pays above the ceiling, guaranteed, rather than merely bidding below it | Turns a fee spike into a hard failure of a paid write. Clamping degrades to slow; refusing degrades to broken, and ADR-0047's asymmetry argument applies -- being wrong toward "slow" is the cheaper mistake |
| Bound the fee as a multiple of the latest block's base fee (rejected) | Chain-agnostic, needs no configuration, and would look like a natural sibling of `GAS_MULTIPLIER` | **Would not have stopped this.** The runaway was the oracle itself climbing; a bound expressed as a multiple of a poisoned reading is poisoned with it. Any rule that derives its ceiling from the same signal that ran away cannot bound the runaway |
| A growth governor: refuse a fee more than N% above the previous send's, within a time window (rejected for now) | The only chain-agnostic option that actually breaks the feedback loop, because it bounds the *rate of change* rather than the level. Would have stopped this run with no configuration at all | Needs durable per-wallet state across sends, and a wrong window silently throttles legitimate escalation during a real spike. Substantially more machinery than the gap justifies today, and it can be added later on top of the ceiling rather than instead of it |

## Decision

The absolute per-gas ceiling applies to every send this backend makes, not only to replacements.

1. `getGasParams` clamps `maxFeePerGas` to `REPLACEMENT_GAS_MAX_FEE_WEI` when that value is
   configured, after the `GAS_MULTIPLIER` doubling. `maxPriorityFeePerGas` is clamped to the same
   value, since a priority fee above the max fee is not a meaningful bid.
2. Clamping never refuses the send. A transaction priced at the ceiling is broadcast; if it is too
   low for the current market it sits in the mempool and the replacement path escalates it under
   ADR-0051, which is the machinery that already exists for exactly that.
3. A clamped send is logged, once per occurrence, with the requested and applied fees. The ceiling
   being reached is a statement about the configuration, not about the write, and it is the same
   signal `cappedBelowOpeningBid` carries on the replacement side.
4. The knob keeps its name. Renaming a configured environment variable to reflect its widened scope
   would break every deployment that sets it, to buy accuracy in a name — a bad trade. Its
   documentation says it governs all sends.

**What this deliberately does not do.** It does not set a default. An unset ceiling leaves a first
send exactly as unbounded as it is today, and the reason is the one already recorded against the
field: a wei value means nothing without knowing the chain. Deployments that want the protection
configure it, and the growth governor above is the option to revisit if that proves insufficient.

## Consequences

**Positive:**

- One policy for what this backend will pay per gas, applied wherever it sends, rather than a
  bounded path and an unbounded one that differ for no decided reason.
- A deployment that configures the ceiling is protected against a fee regime nobody anticipated,
  including one caused by our own traffic.
- The failure mode of the bound is a slow transaction that the replacement path already knows how
  to rescue, not a failed paid write.

**Negative / trade-offs:**

- **Unset by default, so most deployments gain nothing until they configure it.** This is the
  honest cost of refusing to invent a chain-agnostic wei value, and it means this decision improves
  the ceiling's reach rather than closing the gap outright.
- A ceiling set too low silently under-prices every send, which surfaces as slow writes rather than
  as an error. The log line in point 3 is the only signal, and it has to be read.

**Neutral / follow-up:**

- The growth governor is the option that would have stopped the observed run without configuration.
  It is recorded here as the successor to revisit if an absolute ceiling proves too blunt, and it
  composes with this decision rather than replacing it.
- The amplification mechanism remains uncaptured. Anyone who does capture the raw JSON-RPC should
  record it against this ADR, since it is the one claim here resting on inference.
- No schema change, no API change, no change to any error a caller receives.

## References

- [ADR-0047 — evaluator assignment is its own intent and chaining is withdrawn](0047-evaluator-assignment-is-its-own-intent-and-chaining-is-withdrawn.md)
- [ADR-0051 — replacement gas escalates geometrically under a configured cap](0051-replacement-gas-escalates-geometrically-under-a-configured-cap.md)
- `apps/backend/src/services/contract.ts` — `getGasParams`, `GAS_MULTIPLIER`.
- `apps/backend/src/config/env.ts` — `REPLACEMENT_GAS_MAX_FEE_WEI`.
- `apps/backend/src/lib/replacement-gas.ts` — the escalation policy this extends.

# 0036 — Free-submission allowance is 5 per (worker, task)

> **Decision (Y-statement):** In the context of RFC-0006's Tier 1 free-allowance metering for
> bounty/benchmark submissions, facing the fact that the implementation shipped with an agent's
> own placeholder default (3) explicitly flagged as needing human sign-off, we decided to set the
> free-submission allowance to 5 to achieve enough genuine revision room for a worker iterating on
> real feedback without measuring actual worker revision-count data first, accepting that this
> number may need retuning once real usage data exists.

- **Status:** Accepted
- **Date:** 2026-07-31
- **Embodiment:** Implemented
- **Last audited:** 2026-07-31
- **Author:** Beau (drafted by Claude Code, decision made directly by Beau in conversation)
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —
- **Amends / Amended-by:** —

## Context

RFC-0006's Open Question 1 explicitly left the free-allowance size unresolved: "the right number
depends on what a real worker's revision count looks like in practice, which we have not
measured." The implementation that shipped in PR #371 used `FREE_SUBMISSION_ALLOWANCE = 3` as an
agent's own judgment call, documented inline as "not a settled decision" and requiring explicit
human sign-off before being treated as final (`apps/backend/src/config/payments.ts`).

This ADR exists because that sign-off is exactly the kind of decision this repo's own governance
convention (`docs/adr/README.md`) requires a record for — a real choice among genuinely different
numbers, made by a human, worth being able to find later without re-deriving why 5 and not 3 or 10.

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| 3 (the agent's original placeholder — an initial submission plus two revisions) | Already implemented; matches the RFC's own floated candidate | Chosen without any real revision-count data; explicitly flagged in code as not a settled number |
| **5** (chosen) | More genuine iteration room for a worker responding to real requester feedback across a few rounds; still small enough to bound gas/relay exposure meaningfully | Also chosen without real revision-count data — same measurement gap as every other candidate considered here |
| 10 or more | Closer to "effectively unlimited" for most legitimate iteration patterns | Starts eroding the actual goal (bounding relay-gas exposure and review-queue volume) that motivated RFC-0006 in the first place |

## Decision

The free-submission allowance is 5 per `(worker, task)`, replacing the placeholder value of 3 that
shipped in the initial Tier 1 implementation.

## Consequences

**Positive:**

- More realistic room for a worker to genuinely iterate on requester feedback before needing to
  hold USDC, without materially weakening the spam/gas-exposure bound RFC-0006 exists to set.

**Negative / trade-offs:**

- Still not derived from real worker revision-count data — the same open gap RFC-0006's own Open
  Question 1 named. A future retuning based on real usage is expected, not a sign this number was
  wrong.

**Neutral / follow-up:**

- `apps/backend/src/config/payments.ts`'s `FREE_SUBMISSION_ALLOWANCE` constant is updated to `5`,
  with an `Implements: ADR-0036` back-pointer.
- Retune in one place (`FREE_SUBMISSION_ALLOWANCE`) if/when real revision-count data becomes
  available — the constant's own doc comment already says this.

## References

- RFC: `docs/rfc/0006-submission-spam-free-allowance-pricing.md` (Open Question 1)
- ADR-0035 (the Tier 1 mechanism this allowance size configures)
- `apps/backend/src/config/payments.ts`

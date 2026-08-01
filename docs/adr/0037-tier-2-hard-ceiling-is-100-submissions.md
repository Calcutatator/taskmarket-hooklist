# 0037 — Tier 2 hard ceiling is 100 submissions per (worker, task) — NOT a platform-wide limit

> **Decision (Y-statement):** In the context of RFC-0006's Open Question 3 ("is Tier 2 needed at
> all, or does pricing alone bound the exposure acceptably"), facing the fact that Tier 1's pricing
> makes spam expensive but not impossible for a worker willing to pay, we decided to build Tier 2
> — a hard ceiling of 100 submissions, scoped **per individual `(worker, task)` pair, not
> platform-wide or per-worker-across-all-tasks** — to achieve an absolute bound on relay-gas and
> review-queue exposure for any single task regardless of how much a spamming worker is willing to
> spend, accepting a second, independent limiting mechanism on top of Tier 1's pricing rather than
> pricing alone, and accepting that a worker could still reach 100 submissions before the hard cap
> on each of many different tasks (a cross-task or platform-wide bound is a distinct, explicitly
> deferred idea — see Considered options).

- **Status:** Accepted
- **Date:** 2026-07-31
- **Embodiment:** Verified
- **Last audited:** 2026-07-31
- **Author:** Beau (drafted by Claude Code, decision made directly by Beau in conversation)
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —
- **Amends / Amended-by:** Amended by ADR-0038 (mechanism-shape sub-decision only — this ADR's own
  policy decision, ceiling = 100 per `(worker, task)`, is unchanged)

## Context

RFC-0006's Proposal section describes Tier 2 as optional: "pricing may be sufficient on its own. A
limit is invisible to honest users and bounds gas exposure absolutely; pricing makes spam
self-limiting without a threshold that needs continual tuning. They are complementary, not
alternatives." Open Question 3 left whether to build it explicitly unresolved. This ADR resolves
that question and the natural follow-up (what the ceiling should be) together, since answering the
first without the second would leave Tier 2 decided-but-unsized.

The original spam incident that motivated RFC-0006 involved roughly 150 submissions from one
worker to one task — a real number to size a ceiling against, not a hypothetical.

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| Pricing only, no Tier 2 (rejected) | Simplest; no new limiter to build or tune; matches RFC-0006's own framing of Tier 2 as optional | No absolute bound — a worker willing to pay can still submit an unbounded number of times, still consuming relay gas and review-queue space per submission past the free allowance |
| **Build Tier 2, ceiling = 100, per `(worker, task)`** (chosen) | Absolute bound on exposure for any single task regardless of a spamming worker's willingness to pay; 100 is comfortably above any plausible legitimate revision count while still well below the ~150-submission incident that motivated this RFC; scoping per-task keeps the count as cheap as Tier 1's (a single `count(*)` against `submissions` for that `(worker, task)` pair, no cross-task or platform-wide state to maintain) | A second limiter to build, test, and maintain; a threshold that may need retuning; does **not** bound a worker's total activity across many different tasks — 100 per task times many tasks is still a lot of platform-wide volume, a gap the next row names explicitly |
| A lower ceiling (e.g. 20-30) | Tighter bound on worst-case exposure | Closer to plausible legitimate high-iteration cases (e.g. a worker genuinely responding to many rounds of requester feedback); more likely to need an appeal/override path for a false positive |
| Time-windowed (hourly, per task or platform-wide) rate limiting instead of a flat cap (rejected, deferred) | Bounds burst rate, not just total volume — could catch fast automated spam a flat 100-submission cap allows if spread across enough tasks; the existing sliding-window limiter pattern this ADR already reuses (`taskDropSubscribeRateLimits`, `taskAccessPasswordRateLimits`) was built for exactly this shape | Real added complexity: time-window aggregation, and for a platform-wide variant, cross-task shared state — a materially bigger build than a flat per-`(worker, task)` count, which is simple to compute and cheap to reason about (a single `count(*)` against `submissions`, no time dimension, no cross-task state). The flat cap already bounds the concrete incident that motivated this RFC; a time-windowed or platform-wide layer is a real idea worth more thought, not a rejected one, but out of scope for this pass — left as a follow-up discussion topic, not designed here |

## Decision

Build Tier 2: a hard ceiling of 100 submissions, counted **per `(worker, task)` pair** — a fresh
count for every distinct task, not a running total across a worker's activity on the platform, and
not a platform-wide total across all workers. Sits on top of Tier 1's pricing rather than replacing
it.

**Correction (2026-07-31, before implementation began):** RFC-0006's Proposal section originally
pointed at `taskDropSubscribeRateLimits`/`taskAccessPasswordRateLimits`
(`apps/backend/src/db/schema.ts`) as "the pattern to reuse." Reading that code directly (not just
its name) before implementing found it implements a **1-hour sliding window** — `attempts` resets
whenever `windowStartedAt` is more than an hour old. That is a different mechanism from a flat,
permanent ceiling: reusing it as-is would give "100 per hour, forever," not "100 ever," and a
1-hour reset would not have stopped the incident that motivated this RFC (~150 submissions
accumulated over time, not in one burst — a patient spammer submitting 100/hour indefinitely would
sail past it). Tier 2 instead needed a permanent, non-resetting count check with no time dimension
— this ADR's own number and per-task scope are unchanged, only the implementation-pattern
reference was wrong.

**Amended by ADR-0038:** investigating that correction further, before writing Tier 2's own code,
surfaced a broader mechanism question — the codebase already independently duplicates the
sliding-window pattern twice, uncoordinated, with no shared module and no ADR of its own. ADR-0038
decides the actual mechanism shape (a shared rate-limiting module with two distinct check
functions, one time-windowed and one fixed-ceiling) that Tier 2 is built against. This ADR's own
policy decision — the number 100, the per-`(worker, task)` scope — is unchanged by that amendment;
only which module Tier 2's fixed-ceiling check lives in is decided there, not here.

## Consequences

**Positive:**

- An absolute, unconditional bound on relay-gas and review-queue exposure per `(worker, task)`,
  independent of how much a spamming worker is willing to pay past the free allowance.
- 100 is far enough above any plausible legitimate revision count that it should be invisible to
  honest users, matching RFC-0006's own stated goal for a limit.

**Negative / trade-offs:**

- A second limiting mechanism to build, test, and reason about alongside Tier 1's pricing — not a
  simple config toggle on already-shipped code.
- The number is chosen relative to one real incident (~150 submissions) and general judgment, not
  measured data on legitimate high-iteration cases; may need retuning the same way ADR-0036's
  allowance size might.

**Neutral / follow-up:**

- Implemented and test-verified: `apps/backend/src/services/submission-allowance.ts`
  (`isOverHardSubmissionCeiling`) and `apps/backend/src/middleware/submissionAllowanceGate.ts`
  carry `Implements: ADR-0037` back-pointers, and their test files
  (`apps/backend/test/unit/services/submission-allowance.test.ts`,
  `apps/backend/test/unit/middleware/submissionAllowanceGate.test.ts`) carry `Verifies:
  ADR-0037` — `pnpm --filter @taskmarket/adr run adr-audit` computes `Embodiment: Verified`
  from those back-pointers, matching the header above.
- The fixed-ceiling check is built as one of two functions in a new shared rate-limiting module
  (ADR-0038), not as a standalone extension of `submission-allowance.ts` and not by reusing the
  sliding-window tables — see the Decision section's "Amended by ADR-0038" paragraph and
  References.
- Time-windowed and platform-wide rate limiting (Considered options, above) is explicitly a future
  discussion topic, not rejected outright — worth a real look once the flat cap's actual
  cost/benefit is known from real usage, not designed speculatively now.

## References

- RFC: `docs/rfc/0006-submission-spam-free-allowance-pricing.md` (Proposal § "Tier 2", Open
  Question 3)
- ADR-0035 (the Tier 1 mechanism Tier 2 sits alongside)
- ADR-0036 (the Tier 1 allowance size — a related but independent sizing decision)
- **ADR-0038** (amends this ADR: decides the actual mechanism shape — a shared rate-limiting
  module's fixed-ceiling function, not a standalone extension of `submission-allowance.ts` and not
  the sliding-window tables)
- `apps/backend/src/services/submission-allowance.ts` (the permanent count Tier 2's fixed-ceiling
  check reads, per ADR-0038)
- **Not** `taskDropSubscribeRateLimits`/`taskAccessPasswordRateLimits`
  (`apps/backend/src/db/schema.ts`) directly — a time-windowed pattern, wrong fit for a flat cap.
  ADR-0038 tracks bringing them onto the same shared module's time-windowed function as a separate
  follow-up (issue #372, scope updated).

# 0038 — Rate limiting lives in one shared module, not bespoke per-feature logic — with two distinct check shapes, not one forced abstraction

> **Decision (Y-statement):** In the context of implementing RFC-0006 Tier 2 (ADR-0037) and
> discovering the codebase already has two independently-duplicated implementations of the same
> time-windowed rate-limiting logic with no shared module and no ADR of their own, facing the
> choice between adding a third bespoke implementation for Tier 2's fixed-ceiling need or building
> a real shared abstraction, we decided to build one shared rate-limiting module exposing two
> distinct, purpose-built check functions — a generalized time-windowed check and a fixed-ceiling
> check — to achieve one place to look for "how do I rate-limit something" going forward, accepting
> that the two shapes are architecturally different underneath (one owns and mutates its own
> counter state, one reads an existing count from data that already exists for other reasons) and
> are therefore two functions in one module, not one function forced to cover both.

- **Status:** Accepted
- **Date:** 2026-07-31
- **Embodiment:** Verified
- **Last audited:** 2026-07-31
- **Author:** Beau (drafted by Claude Code, decision made directly by Beau in conversation)
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —
- **Amends / Amended-by:** Amends ADR-0037 (see Consequences — the mechanism-shape sub-decision in
  ADR-0037's Decision section is corrected here; ADR-0037's actual policy decision, the ceiling of
  100 per `(worker, task)`, is unchanged)

## Context

While implementing RFC-0006 Tier 2, reading the codebase's existing rate-limiting code
(`apps/backend/src/services/task-drop-subscribe-rate-limit.ts`,
`apps/backend/src/lib/task-access-password.ts`) before reusing it (per ADR-0037's original
Decision) surfaced two things:

1. The two existing limiters independently duplicate the same sliding-window CASE-WHEN SQL almost
   verbatim — different table/column names, identical mechanics (1-hour window, an `attempts`
   counter, `onConflictDoUpdate` reset-or-increment). ADR-0030 documents the second one as
   "modeled on" the first; the first has no ADR of its own recording why a DB-backed sliding window
   was chosen over alternatives. This was already filed as issue #372, scoped as "extract a shared
   utility, backfill the missing ADR" — a narrower fix than this ADR ends up deciding.
2. Neither existing limiter's shape actually fits Tier 2's need. Both maintain their own counter
   state in a dedicated table, incrementing on every attempt and resetting after a time window.
   Tier 2 needs something different in kind: a read-only count against data that already exists for
   an unrelated reason (the `submissions` table, which Tier 1 already counts permanently, with no
   time dimension). Tier 2 doesn't need to *own* any new state at all.

Given a third bespoke implementation was about to be written for Tier 2 (ADR-0037's original
Decision: "extends Tier 1's own already-shipped mechanism... no new table"), and two duplicated
implementations of a different shape already exist uncoordinated in the codebase, this is the
moment to decide whether rate limiting should be a real, shared platform capability instead of
independently reinvented per feature — not after a fourth need shows up.

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| Bespoke per feature (ADR-0037's original plan — Tier 2 extends Tier 1's count directly, the two existing limiters stay as they are) | Simplest for Tier 2 alone; zero risk to already-shipped, working code | Leaves the two existing duplicated implementations un-deduplicated (issue #372's problem persists); the next feature that needs rate limiting has no shared starting point and will likely duplicate again, the same way the second sliding-window limiter duplicated the first |
| One fully unified function/table covering both shapes (rejected) | Maximum code reuse on paper — a single call site for "rate limit this" | A leaky, forced abstraction: a time-windowed check owns and mutates counter state in its own table; a fixed-ceiling check only ever reads a count that already exists elsewhere for another reason. Forcing both through one function/table means either the fixed case pays for state it doesn't need, or the time-windowed case loses its own dedicated table for no benefit. Same shape of mistake as reusing the sliding-window tables directly for Tier 2 in the first place (ADR-0037's own correction) — picking one mechanism and stretching it to cover a case it doesn't actually fit |
| **One shared module, two distinct check functions** (chosen) | One place to look for "how do I rate-limit something" going forward — the actual goal — without forcing the two genuinely different shapes into one interface that fits neither well. Each function is purpose-built and simple on its own terms | Two functions to learn instead of one, though this is a small cost against the alternative of pretending they're the same thing when they aren't |

## Decision

Build `apps/backend/src/lib/rate-limit.ts` (exact filename subject to normal implementation
judgment) exposing two functions:

1. **A generalized time-windowed check** — parameterized version of the CASE-WHEN
   reset-or-increment logic both existing limiters already implement independently, taking a
   table/key/window/limit as parameters instead of being copy-pasted per feature.
2. **A fixed-ceiling check** — a read-only count against an existing, already-recorded data source,
   compared to a threshold. No new table, no owned state. This is what RFC-0006 Tier 2 uses.

**Correction (2026-07-31, same day, before either function was built):** the first draft of this
ADR deferred migrating `task-drop-subscribe-rate-limit.ts` and `task-access-password.ts` onto
function 1 as separate follow-up work (issue #372). On reflection, that split doesn't hold up: this
ADR's own stated goal is "one place to look for how do I rate-limit something," and RFC-0006's own
higher-level intent (stated directly by the decider) is to implement rate limiting as a real,
coherent platform capability, not two unrelated point fixes. Landing function 1 without actually
migrating its only two real callers onto it would leave the codebase with three independent
implementations in spirit — the exact fragmentation this ADR exists to end — for an indefinite
period with no forcing function to ever finish it. **Both functions, and migrating both existing
limiters onto function 1, are in scope together, as one piece of work, specified in
`docs/specs/submission-tier-2-hard-ceiling.md`.** Issue #372 is closed, not left open with an
updated scope — its remaining content is fully absorbed into this ADR and that spec.

## Consequences

**Positive:**

- Tier 2 gets a correctly-shaped, minimal mechanism (no new table) instead of either a bespoke
  one-off or a forced-fit onto the wrong existing pattern.
- The next feature that needs either shape of rate limiting has a real shared starting point,
  closing the gap that let the same sliding-window logic get duplicated once already.
- The genuine architectural difference between "owns state" and "reads existing state" is named
  and respected in the design, not papered over for the sake of a single interface.

**Negative / trade-offs:**

- This ADR amends ADR-0037's own Decision section — the mechanism sub-decision there ("extends
  Tier 1's own count directly, standalone, no new table") is now more precisely "extends Tier 1's
  count via the new shared module's fixed-ceiling function," a real but small correction, made
  before any Tier 2 code existed to be affected by it.
- The scope of the implementation work behind this ADR is now larger than "just Tier 2" — it
  includes migrating two already-shipped, working call sites. Real regression risk on code that
  wasn't broken, mitigated by the "zero behavior change" constraint in the spec (same window, same
  limits, same table schemas; only the SQL construction is deduplicated) and by keeping both
  existing test suites passing unchanged as a hard requirement, not a nice-to-have.

**Neutral / follow-up:**

- Issue #372 closed — its scope (extract a shared utility; backfill a missing ADR for the original
  sliding-window decision) is fully covered by this ADR (the backfill) and the spec (the
  extraction + migration), so there is no remaining work to leave it open for.
- Implemented and test-verified: `apps/backend/src/lib/rate-limit.ts` (both `isOverFixedCeiling`
  and `consumeSlidingWindowAttempt`) carries `Implements: ADR-0038` back-pointers, its own test
  file (`apps/backend/test/unit/lib/rate-limit.test.ts`) carries `Verifies: ADR-0038`, and both
  migrated callers (`apps/backend/src/services/task-drop-subscribe-rate-limit.ts`,
  `apps/backend/src/lib/task-access-password.ts`) carry `Implements: ADR-0038` too, with their
  pre-existing test files passing unmodified as the zero-behavior-change proof. `pnpm --filter
  @taskmarket/adr run adr-audit` computes `Embodiment: Verified` from those back-pointers,
  matching the header above.

## References

- RFC: `docs/rfc/0006-submission-spam-free-allowance-pricing.md`
- ADR-0037 (amended by this ADR — policy decision unchanged, mechanism-shape sub-decision
  corrected)
- Spec: `docs/specs/submission-tier-2-hard-ceiling.md` (both functions, both migrations, one piece
  of work)
- Issue #372 (closed — scope fully absorbed into this ADR and the spec above, not left open)
- `apps/backend/src/services/task-drop-subscribe-rate-limit.ts`,
  `apps/backend/src/lib/task-access-password.ts` (the two existing implementations migrated onto
  this ADR's shared module by the spec above)

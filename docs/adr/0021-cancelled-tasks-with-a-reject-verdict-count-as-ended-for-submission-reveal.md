# 0021 — A task cancelled via a REJECT evaluator verdict counts as "ended" for submission-visibility reveal purposes

> **Decision (Y-statement):** In the context of implementing Phase 2's submission-visibility
> lifecycle gate (ADR-0016), facing the discovery that `evaluations.router.ts`'s
> `finalizeVerdict` sets `tasks.status` to `'cancelled'` on a REJECT verdict -- the same status
> value the plain, pre-submission `cancelTask` mutation uses for an entirely different,
> unresolved case -- we decided to treat a `cancelled` task as "ended" for
> `reveal_all`/`winner_only` purposes when and only when `tasks.verdictType === 'REJECT'`,
> to achieve the RFC's stated intent that those modes take effect "once the task ends"
> regardless of which terminal outcome ended it, accepting that this makes `isTaskEnded`
> depend on a second column (`verdictType`) instead of `status` alone, and that a
> `cancelled` status is no longer a single, unambiguous "nothing to reveal" signal on its own.

- **Status:** Accepted
- **Date:** 2026-07-21
- **Accepted:** 2026-07-23
- **Embodiment:** Verified
- **Last audited:** 2026-07-29
- **Author:** Beau
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —

## Context

Phase 2 (ADR-0016) defines `submissionVisibility`'s lifecycle gate as: while a task is
active, the requester sees all submissions and each submitting worker sees only their
own; "once the task ends," `reveal_all` reveals everything and `winner_only` reveals the
`task_awards`-linked winner(s). The RFC's own lifecycle table
(`docs/rfc/0005-task-visibility-and-submission-visibility.md`, "Time + role gated reveal")
names exactly two "Ended" statuses: `completed` and `expired`. It does not mention
`cancelled` at all.

The initial Phase 2 implementation (`apps/backend/src/lib/submission-visibility.ts`)
followed that table literally: `isTaskEnded` treated only `completed`/`expired` as ended,
with a comment reasoning that "cancelled tasks never collect a resolution outcome." That
reasoning is correct for `tasks.router.ts`'s plain `cancel` mutation, which only succeeds
when `task.status === 'open'` and (for bounty/benchmark) zero *active* (non-rejected)
submissions exist -- by the time a task reaches `cancelled` this way, any submissions
still on the row are already individually rejected, so there is genuinely no fresh
outcome to reveal.

A deep review of the PR implementing Phase 2 found a second, structurally different path
to the same `cancelled` status: `evaluations.router.ts`'s `finalizeVerdict`, on a REJECT
verdict (after a worker submitted, an evaluator ruled, and the appeal window ran without
a successful appeal), also sets `status: 'cancelled'` -- refunding the requester and
terminating the task rather than reopening it. This is a genuine, fully-resolved terminal
outcome, not an early, resolution-free cancel. Under the original (RFC-literal)
implementation, a `reveal_all` task that reached this exact path would keep its rejected
submission hidden from third parties *forever*, contradicting the RFC's stated intent that
`reveal_all` shows everything "once the task ends" -- this task genuinely ended, just via
a different terminal status value than the RFC's table anticipated.

`verdictType` (`tasks.verdict_type`) is set when a verdict is submitted and is never
cleared by `finalizeVerdict`'s REJECT branch, so `status === 'cancelled' && verdictType
=== 'REJECT'` is a reliable, already-available signal for "this cancellation was a real
resolved outcome," distinguishing it from the plain-cancel path (where `verdictType` is
always `null`, since a plain-cancel task never had an evaluator).

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Treat `cancelled` as ended only when `verdictType === 'REJECT'` (chosen) | Matches the RFC's stated intent ("once the task ends") for the one `cancelled` path that is a genuine resolution; leaves the plain-cancel path's "nothing to reveal" behavior exactly as the RFC described it; uses a signal (`verdictType`) already persisted on the row, no schema change | `isTaskEnded` now depends on two columns instead of one, a small increase in the predicate's surface area; a future third path to `cancelled` would need its own signal audited the same way, not automatically covered |
| Leave `cancelled` as always-active, matching the RFC's literal table (rejected) | Simplest, matches the RFC text exactly, zero additional signal needed | A `reveal_all`/`winner_only` task resolved via evaluator REJECT would hide its (rejected) submission from third parties forever, silently breaking the mode's own stated promise for that one lifecycle path -- an RFC gap, not a considered decision, and not something to preserve just because it's what the table originally said |
| Treat every `cancelled` task as ended unconditionally, regardless of `verdictType` (rejected) | Simpler predicate (`status`-only, matching `completed`/`expired`'s shape) | Wrong for the plain-cancel path: those submissions were already individually rejected by the requester with no evaluator involved, and there is no product reason to suddenly reveal them under `reveal_all`/`winner_only` just because the task's own status is `cancelled` -- would reveal content when nothing was actually resolved |

## Decision

`isTaskEnded(status, verdictType?)` returns `true` for `completed`/`expired` (unchanged),
and additionally for `status === 'cancelled'` when `verdictType === 'REJECT'`. Every
`canViewSubmission` call site that can reach a `cancelled` task (`listByTask`,
`previewArtifact`) now selects and passes `tasks.verdictType` alongside
`tasks.status`. `download`'s call site also passes it for consistency, though it is
currently unreachable there (that endpoint already rejects any non-`completed` status
before reaching the visibility check).

## Consequences

**Positive:**
- `reveal_all`/`winner_only` now behave consistently with their own stated "once the task
  ends" promise across every real terminal outcome a task can reach, not just two of the
  three status values that can end one.
- No schema change or new signal needed -- `verdictType` was already being written and
  persisted, just not previously consulted for this purpose.

**Negative / trade-offs:**
- `isTaskEnded`'s contract is now slightly more complex (two inputs, one conditional
  status value) than the RFC's original two-status table describes. The RFC needs a
  follow-up edit (tracked in the same PR) to describe this so a future reader of the RFC
  and a future reader of the code do not disagree with each other.
- Any future new path that lands a task in `cancelled` for a different reason will need
  its own explicit audit against this predicate -- there is no structural guarantee that
  every future `cancelled` write path gets remembered here.

**Neutral / follow-up:**
- This ADR does not revisit whether a REJECTed submission *should* be revealed under
  `reveal_all` as a product matter (as opposed to the narrower "does 'ended' apply here"
  question) -- that was already implicit in `reveal_all`'s existing definition (reveal
  everything once the task ends, with no carve-out for a rejected verdict), and this ADR
  only makes the lifecycle gate consistent with that existing definition rather than
  reopening it.

## References

- ADR-0016 — Submission visibility is an independent axis, defaulting to public and
  locked in at creation (the decision this ADR extends the lifecycle gate of)
- `docs/rfc/0005-task-visibility-and-submission-visibility.md` — "Time + role gated reveal"
  section (needs a follow-up edit to describe the `cancelled`/`verdictType` case)
- `apps/backend/src/routers/evaluations.router.ts` — `finalizeVerdict`'s REJECT branch
- `apps/backend/src/lib/submission-visibility.ts` — `isTaskEnded`, `canViewSubmission`

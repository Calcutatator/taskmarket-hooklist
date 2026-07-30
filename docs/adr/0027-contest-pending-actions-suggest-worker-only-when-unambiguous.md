# 0027 — Contest `pendingActions` suggest a worker address only when there is exactly one distinct submitter

> **Decision (Y-statement):** In the context of `computePendingActions` (tracked as issue #243)
> pre-filling the `accept`/`reject_submission` suggested commands for open-contest
> (`bounty`/`benchmark`, no evaluator) tasks with whichever submitter's row has the newest
> `created_at`, facing the fact that resubmission is free and unlimited so any non-winning
> submitter can keep themselves as "most recent" indefinitely and capture the suggested-worker
> slot shown to the requester and to any AI agent reading `pendingActions` programmatically, we
> decided to only populate the suggested worker address when the task has exactly one distinct
> submitter, omitting it (falling back to the existing `<address>` placeholder) whenever more
> than one distinct address has submitted, to achieve removing the specific "spam to stay on
> top" incentive without adding a reputation or ordering model, accepting that a requester
> facing multiple legitimate submitters gets no suggested address at all and must pick one
> manually.

- **Status:** Accepted
- **Date:** 2026-07-23
- **Embodiment:** Implemented
- **Last audited:** 2026-07-28
- **Author:** Beau
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —

## Context

Issue #243 (security report) found that for `bounty`/`benchmark` tasks with no evaluator,
`computePendingActions` (`apps/backend/src/lib/task.ts:133`) suggests a concrete
`--worker <address>` for both the `accept` and `reject_submission` pending actions using:

```ts
const workerAddress = task.claimedBy ?? task.latestSubmissionWorker ?? null;
```

`task.claimedBy` only applies to claim-mode tasks with an explicit on-chain claim. For
open-contest tasks (multiple independent submitters, no claim), this always resolves to
`latestSubmissionWorker` — whichever submitter's row has the newest `submittedAt`, with no
quality, reputation, or legitimacy signal behind it. `reject_submission`
(`apps/backend/src/lib/task.ts:189`) uses the identical fallback directly against
`task.latestSubmissionWorker`.

On a real bounty task, a non-winning submitter resubmitted 108 times in succession, keeping
themselves as `latestSubmissionWorker` and therefore as the address auto-populated into the
suggested `accept ... --worker <address>` command shown to the requester (and to any AI agent
reading `pendingActions` programmatically). One of those resubmissions embedded a
prompt-injection payload aimed at getting an AI reviewer to run a wallet-draining command under
the guise of an "ACCEPT" notice. The resubmission-spam behavior itself, independent of the
injection payload, is what let an illegitimate submitter capture the suggested-worker slot.

The suggested command is UX sugar, not an authorization boundary — the requester still has to
actually run it — but it is exactly the kind of pre-filled, plausible-looking default that both
humans skimming quickly and AI agents consuming `pendingActions` programmatically are liable to
trust without independently reviewing all submissions first. "Most recent" rewards spam, not
merit, and costs the attacker nothing.

## Considered options

| Option                                                                                                                                                                                                                                                                          | Pros                                                                                                                                                                                                                                                                                                                             | Cons                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Only suggest a worker when unambiguous** (chosen): if there is exactly one distinct submitter, keep suggesting them; if there is more than one distinct submitter and no `claimedBy`, omit the suggested address entirely (fall back to the existing `<address>` placeholder) | Cheapest fix; forces a conscious choice instead of handing out a pre-filled command once there is any ambiguity; the single-submitter case (by far the common case) keeps working exactly as before, since "the one submitter" and "the most recent submitter" are the same address when only one distinct address has submitted | A requester with several legitimate concurrent submitters gets no suggested address at all, even though one of them may be an obviously strong choice                                                                                                                                |
| Order by first submission, not most recent (rejected)                                                                                                                                                                                                                           | Removes the specific "spam to stay on top" exploit; still suggests _someone_ even with multiple submitters                                                                                                                                                                                                                       | Requires tracking each distinct worker's first-submission timestamp separately from the existing "most recent" query; an attacker who is simply first (not necessarily best) still benefits, so it substitutes one arbitrary ordering for another rather than removing arbitrariness |
| Weight by reputation (rejected)                                                                                                                                                                                                                                                 | Prefers the distinct submitter with the strongest track record; removes free resubmission as a lever entirely                                                                                                                                                                                                                    | Does not fully solve it — a new-but-legitimate worker can still lose the suggestion to an established one on a given task; meaningfully larger change (needs to read and weigh `completed_tasks`/rating history at suggestion time) for a fix that is meant to be cheap              |
| Surface a resubmission-count signal alongside the existing suggestion (rejected)                                                                                                                                                                                                | Makes an unusually high resubmission count visible to whoever is about to act, regardless of which address is suggested                                                                                                                                                                                                          | Complementary to a real fix, not a substitute — it still hands out a pre-filled command for the spamming address, just with an extra number next to it that a fast-skimming human or an agent may not weigh correctly                                                                |
| Do nothing (rejected)                                                                                                                                                                                                                                                           | No implementation cost                                                                                                                                                                                                                                                                                                           | Issue #243 stays open and exploitable; not acceptable as a permanent answer                                                                                                                                                                                                          |

## Decision

`computePendingActions`'s worker-suggestion input changes from "the most recent submitter" to
"the sole distinct submitter, if there is exactly one." Concretely:

- The backend query that currently fetches the single most-recently-submitted worker address
  (`apps/backend/src/routers/tasks.router.ts`, used in both the `get` and `update` routers) is
  replaced with a query for _distinct_ active (non-rejected) submitter addresses for the task,
  capped at 2 rows (only 0 vs. 1 vs. "2 or more" matters).
- If exactly one distinct address exists, it is passed through unchanged (still subject to the
  existing submission-visibility gate, ADR-0016) as the suggested worker for both `accept` and
  `reject_submission`.
- If zero or two-or-more distinct addresses exist, no suggested address is passed through, and
  both commands fall back to the existing `<address>` placeholder.
- `task.claimedBy` (a separate, already-public field for auction/claim/pitch selection, not a
  submission) is untouched and keeps taking priority when set.

This closes the specific exploit — unlimited free resubmission can no longer capture the
suggested-worker slot — without introducing a reputation model, a first-submission-tracking
column, or a resubmission-count field, all of which were assessed as viable but more expensive
follow-ups rather than necessary for this fix.

## Consequences

**Positive:**

- Removes the "resubmit repeatedly to stay suggested" incentive entirely: with two or more
  distinct submitters, no address is suggested at all, so there is nothing left to game.
- No behavior change for the common single-submitter case — the suggested address is identical
  to what was suggested before, since "the one submitter" and "the most recent submitter" are
  the same address when only one has submitted.
- Small, localized change: one query shape change per call site (`get`, `update`), no schema or
  API surface change (`latestSubmissionWorker` was already an internal `computePendingActions`
  input, never serialized to clients).

**Negative / trade-offs:**

- A requester facing multiple legitimate concurrent submitters now gets no suggested address at
  all for `accept`/`reject_submission`, even when a human reviewing the submissions list would
  find an obvious choice. They must copy an address manually from the submissions list.
- Does not by itself surface a resubmission-count signal or otherwise flag an unusually spammy
  submitter to the requester — a caller only sees the absence of a suggestion, not why.

**Neutral / follow-up:**

- Options 3 (reputation weighting) and 4 (resubmission-count signal) from the issue remain
  legitimate complementary follow-ups if requesters find the "no suggestion" case for legitimate
  multi-submitter contests too disruptive in practice.

## References

- Issue #243 — `Security: accept/reject_submission pendingAction suggests --worker by
most-recent submission, which is gameable by resubmission spam`
- `apps/backend/src/lib/task.ts` — `computePendingActions`, `workerAddress` fallback
- `apps/backend/src/routers/tasks.router.ts` — `visibleLatestSubmissionWorker` and its two call
  sites (`get`, `update`)
- ADR-0016 — submission-visibility gate that the suggested address must still respect

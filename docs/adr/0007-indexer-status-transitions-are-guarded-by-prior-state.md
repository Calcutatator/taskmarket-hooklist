# 0007 — Indexer status-transition handlers are guarded by valid prior state

> **Decision (Y-statement):** In the context of the indexer's event handlers writing
> `tasks.status` unconditionally on every poll, facing a live-verified regression where a
> late-processed `TaskEvaluated` event overwrote a `completed` task back to `appealing` after a
> synchronous router write had already settled it, we decided to add a `WHERE`-clause "only
> apply from a valid prior status" guard to every indexer handler that transitions `tasks.status`
> to achieve idempotent, order-independent event application, accepting that each handler now
> needs its valid-prior-states set kept in sync with the corresponding router mutation's own
> status guard.

- **Status:** Accepted
- **Date:** 2026-07-16
- **Embodiment:** Verified
- **Last audited:** 2026-07-29
- **Author:** Beau
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —

## Context

ADR-0006 fixed `resolveDispute` and `finalizeVerdict`'s approve path to write `task_awards` (and
flip `tasks.status` to `completed`) synchronously, inside the mutation itself, instead of relying
solely on the async indexer picking up the resulting `TaskCompleted` event(s) on its next poll.

Live end-to-end verification of that fix (`make smoke evaluator`) surfaced a second, pre-existing
bug it exposed rather than caused: a task that had just been synchronously completed by
`finalizeVerdict`'s all-zero-award branch was observed, moments later, regressed back to
`appealing`. Root cause, confirmed via `cast receipt` (no `TaskCompleted` log — a legitimate
all-zero-award verdict) and backend log timestamps: the async indexer, still catching up on an
earlier block range, processed the `TaskEvaluated` event from the original `evaluate()` call
*after* `finalizeVerdict`'s synchronous write had already advanced the task past `appealing`.
`processTaskEvaluatedEvent` writes `status: 'appealing'` with no `WHERE` clause beyond the task
ID, so this late — but not literally "already processed" (the `(chainId, blockNumber, logIndex)`
dedup key had never seen this event before) — application silently regressed a terminal-in-
practice state with nothing left on-chain to re-advance it. The task was permanently stuck.

Auditing every indexer handler that writes `tasks.status` (`processTaskClaimedEvent`,
`processTaskWorkerSelectedEvent`, `processTaskSubmittedEvent`'s conditional review-status write,
`processTaskExpiredEvent`, `processTaskCancelledEvent`, `processAuctionAcceptedEvent`,
`processTaskReopenedEvent`, `processTaskEvaluatedEvent`, `processTaskAppealedEvent`,
`processEvaluatorTimedOutEvent`) found the same shape in every one of them: an unconditional
`.where(eq(tasks.id, taskId))`, with no guard against the task having already moved past the
state this event implies. This is a pre-existing pattern, not something introduced by ADR-0006 —
ADR-0006 only made the race observable by closing the gap on one side of it (the synchronous
write now reliably wins the "gets there first" race that used to be won by the indexer almost
all the time, by default, simply because it used to be the only writer).

One handler already had this exact guard: `bids.router.ts`'s `auctionAccept` conditionally
updates `.where(and(eq(tasks.id, ...), eq(tasks.status, 'open')))` and checks the returned row
count, specifically to guard against a concurrent claim. That pattern is the template this ADR
generalizes to the indexer.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Guard every indexer status-write with a "valid prior state(s)" `WHERE` clause, mirroring each corresponding router mutation's own status guard (chosen) | Makes every handler idempotent and order-independent — reprocessing a late or out-of-order event becomes a silent no-op instead of a regression; no new tables, columns, or locking; reuses the exact pattern already proven in `bids.router.ts` | Each handler's valid-prior-states set must be kept in sync with its router counterpart by hand; a future status added to the state machine without updating both sides could reintroduce a narrower version of the same bug |
| Add a monotonic `status_version`/state-ordering column and guard every write with `status_version < new_version` (rejected) | Fully general, doesn't require enumerating valid prior states per transition, catches any future ordering violation automatically | New column plus a migration to backfill/maintain it; the task state machine isn't a strict total order (e.g. `appealing` can go to either `disputed` or `completed`/`cancelled`), so a single version number can't express "valid" without also encoding the same per-transition rules this ADR's chosen option already needs |
| Make the indexer strictly sequential per task (process all of a task's events in one transaction, never interleaved with router writes) (rejected) | Would eliminate the race at its root | Large architectural change to the indexer's polling/checkpoint model; still wouldn't help the specific race here, where the "other writer" is a synchronous router mutation racing an async poller, not two indexer runs racing each other |

## Decision

Every `tasks.status`-writing handler in `apps/backend/src/services/indexer.ts` now conditions its
`UPDATE` on the task's current status being one of the states the corresponding router mutation
itself requires as a precondition for triggering that on-chain event in the first place:

- `processTaskClaimedEvent`, `processTaskWorkerSelectedEvent`, `processTaskCancelledEvent`,
  `processAuctionAcceptedEvent`: guarded to `status = 'open'` (mirrors `claim()`,
  `pitches.selectWorker`/`bids.selectWinner`, `cancel()`, and `auctionAccept` respectively).
  `TaskWorkerSelected` fires from two different contract functions with two different on-chain
  outcomes — `CoreFacet.selectWorker` (pitch mode -> `WorkerSelected`) and
  `AuctionFacet.selectLowestBidder` (auction english/reverse_english mode -> `Claimed`) — so
  `processTaskWorkerSelectedEvent` looks up the task's mode before deciding which status to
  write, in addition to the prior-state guard; this was a pre-existing mode-blindness bug in the
  handler (it always wrote `worker_selected`) found during PR review, fixed in the same change
  as the guard.
- `processTaskSubmittedEvent`'s conditional review-status write: guarded to
  `status IN ('open', 'claimed', 'worker_selected', 'pending_approval')`. The real per-mode
  preconditions live in `submissions.router.ts`'s `submit`/`submitFromKeys` (not
  `requestUploadUrl`, which is a separate, broader storage-quota check): `claimed` for claim
  mode, `worker_selected` for pitch mode, `claimed` for auction mode. Since this branch only
  ever runs for claim/pitch/auction (`shouldStartEvaluatorReview` excludes bounty/benchmark), the
  same router mutation already flips status to `pending_approval` synchronously on submit for
  all three, before this event is normally processed — `pending_approval` is therefore the state
  this handler actually finds in the common case. `'open'` is included for defensive symmetry but
  is currently unreachable for this specific branch (no mode that reaches it has `submit`
  callable from `open`).
- `processTaskExpiredEvent`: guarded to `status NOT IN ('expired', 'completed', 'cancelled')`
  (mirrors `refundExpired`'s own rejection list).
- `processTaskReopenedEvent`: guarded to `status = 'claimed'` (mirrors `forfeitAndReopen`, its
  only trigger).
- `processTaskEvaluatedEvent`: guarded to `status IN ('open', 'pending_approval', 'review')`
  (mirrors `evaluate()`'s `isOpenModeEval`/`isReviewModeEval` check — this is the handler that
  caused the observed regression).
- `processTaskAppealedEvent`: guarded to `status = 'appealing'` (mirrors `appeal()`).
- `processEvaluatorTimedOutEvent`: guarded to `status = 'review'` (mirrors `evaluatorTimeout()`).

Each guarded `UPDATE` uses `.returning({ id: tasks.id })` and logs when the update affected zero
rows, so a skipped (stale/out-of-order) event is visible in logs rather than silently vanishing.

`processTaskCreatedEvent` (an `INSERT ... ON CONFLICT DO NOTHING`) and the `recordTaskSettlement`/
`finalizeVerdict`/`resolveDispute` completion writes (which set the terminal `status = 'completed'`
and are safe to reapply idempotently, since the on-chain contract has no path back out of a real
completion) were left unguarded — neither can regress a task, by construction.

## Consequences

**Positive:**
- The indexer's event handlers are now idempotent and order-independent with respect to
  synchronous router writes: an event processed late can no longer regress a task's status past
  where a faster synchronous write already took it.
- The specific bug observed live (a `completed` task regressed to `appealing`, permanently stuck)
  is closed.
- Follows an existing, already-reviewed pattern in this codebase (`bids.router.ts`'s
  `auctionAccept`), rather than introducing a new one.

**Negative / trade-offs:**
- Each handler's valid-prior-states list is duplicated knowledge — it must stay in sync with the
  corresponding router mutation's own guard by hand. A future change to either side without the
  other could reintroduce a narrower version of this bug for that one transition.
- A guard that is too narrow (missing a legitimate prior state) would turn a real event into a
  silently-skipped no-op instead of a regression — a different failure mode, traded deliberately
  for the one this ADR closes, and mitigated by the added skip-logging.
- **A status-equality guard is not a full ordering fix — it can still misfire on a re-entered
  state ("ABA" pattern), not just detect "already past."** The guard only checks "is the task's
  *current* status one of the valid prior states," not whether *this specific event* is the one
  that produced it. For states a task can legitimately revisit (most notably `claimed`, via a
  claim -> forfeit/reopen -> reclaim cycle), a sufficiently stale event can coincidentally match a
  *later, unrelated* instance of that state rather than the one it actually describes. Concrete
  case: worker A claims a task; the requester forfeits and reopens it (synchronous write:
  `status='open'`) while the `TaskReopened` event for that forfeit sits unprocessed in an
  indexer backlog; worker B then claims the now-open task (synchronous write: `status='claimed'`,
  `claimedBy=B`); the indexer finally processes the stale `TaskReopened` event, sees
  `status='claimed'` (true, but because of B's claim, not A's), and incorrectly reopens the task
  out from under B. This requires indexer lag spanning a full reopen-reclaim cycle to trigger —
  a narrower window than the bug this ADR closes, and not observed in practice — but it is a real
  gap in the chosen design, not merely a "too narrow" no-op. Closing it fully would need
  something closer to the rejected `status_version`/ordering-column alternative above (or per-task
  last-applied-block tracking), which was deliberately not built here since nothing currently
  demonstrates this case occurring; revisit if it does.

**Neutral / follow-up:**
- The ten guarded handlers are exported from `indexer.ts` and covered by
  `test/integration/services/indexer-status-guards.test.ts`, which seeds a task at each relevant
  status against a real test database and asserts each guarded `UPDATE` either applies or
  correctly no-ops. This complements, but does not replace, the live smoke testing
  (`make smoke evaluator`) that originally found this bug class — the integration tests verify
  the guard clauses in isolation; they do not reproduce the actual async-ordering race between a
  live indexer poll and a live router mutation.

## References

- ADR-0006 (`task_awards` single source of truth; the settlement-race fix that exposed this bug).
- ADR-0003 (backend boot fail-fast reconciliation — a different, complementary safety net; does
  not catch this bug because the task row is never missing an award, it is transiently
  mis-classified by status).
- `apps/backend/src/services/indexer.ts` (all guarded handlers).
- `apps/backend/src/routers/bids.router.ts` (`auctionAccept` — the pre-existing pattern this ADR
  generalizes).
- `apps/backend/src/routers/evaluations.router.ts` (`evaluate`, `appeal`, `finalizeVerdict`,
  `resolveDispute`, `evaluatorTimeout` — the router-side status guards each handler mirrors).

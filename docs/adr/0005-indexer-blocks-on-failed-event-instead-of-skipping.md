# 0005 — Indexer main event stream blocks on a failed event instead of skipping it

> **Decision (Y-statement):** In the context of the on-chain indexer's main event-processing
> loop (`processEvents` in `indexer.ts`), facing the question of whether a single event that
> fails to process should block the poll range's checkpoint or be logged and skipped so later
> events keep flowing, we decided to log full event context and re-throw — blocking the
> checkpoint and causing the next poll to retry the same range — to achieve in-order,
> at-least-once processing with no silently-lost events, accepting that one persistently
> failing event stalls indexing for every event after it until the failure is manually
> resolved.

- **Status:** Accepted
- **Date:** 2026-07-16
- **Embodiment:** Implemented
- **Last audited:** 2026-07-29
- **Author:** Beau
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —

## Context

`processEvents(fromBlock, toBlock)` fetches every main-contract log in a block range and
processes them in order in a single loop, advancing a range checkpoint only once the whole
range succeeds. During this review's live smoke testing, an unhandled failure partway through
that loop was found to be diagnostically opaque — the error surfaced with no indication of
which event, task, or transaction caused it, making a stalled indexer hard to triage from logs
alone.

Two sibling loops in the same file take the opposite approach: `processIdentityEvents`
(`MetadataSet` events, wallet-linking) and `processRewardHookEvents` (reward-hook audit-log
events) each wrap their per-log body in try/catch, log the error, and `continue` to the next
log — a bad event is skipped rather than blocking. This raised the question of whether the
main stream's blocking behavior was itself a bug to fix (mirror the skip-and-continue pattern)
or the correct, intentional design that just needed better diagnostics.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Block and retry: log full event context, re-throw, checkpoint does not advance (chosen) | Guarantees in-order, at-least-once processing for the main stream, where most event types (`TaskCreated`, `TaskClaimed`, `TaskCompleted`, `TaskRated`, bids, etc.) are causally ordered and several have no independent reconciliation job to catch a silently dropped event later; a stuck indexer is loud (checkpoint stops advancing, repeated identical errors in logs) rather than silently degraded | One persistently failing event (e.g. a malformed log, a downstream DB constraint violation) blocks every event after it in the main stream indefinitely, until a human diagnoses and resolves the root cause or manually advances the checkpoint |
| Catch-and-skip, mirroring `processIdentityEvents`/`processRewardHookEvents` | A single bad event no longer blocks unrelated later events; matches the pattern already used elsewhere in the same file | Most main-stream event types have no equivalent of `configured-task-awards-backfill.ts`'s reconciliation pass to catch a silently skipped event after the fact; skipping a `TaskCompleted` or `TaskWorkerSelected` event, for example, would leave a task permanently in the wrong state with no automated repair path and no loud signal that it happened |
| Per-event-type policy: block on causally-load-bearing events (task lifecycle), skip-and-log on the rest | Right-sizes the guarantee to where it matters | Meaningfully more complex to implement and reason about correctly; no evidence during this review that indexer stalls are frequent enough to justify the added surface area over the simpler uniform policy |

## Decision

The main stream keeps its existing block-on-failure behavior unchanged. The only change made
during this review was diagnostic: the catch block now logs `eventName`, `taskId`,
`blockNumber`, `logIndex`, `transactionHash`, and the error itself before re-throwing
(`indexer.ts`, inside `processEvents`), so a stall is now identifiable from logs instead of
requiring a debugger session to find which event caused it.

## Consequences

**Positive:**
- In-order, at-least-once delivery for the main event stream is preserved: no main-stream event
  can be silently dropped by a transient failure.
- A stall now logs enough context (event name, task ID, block/log index, tx hash) to diagnose
  and, if appropriate, manually resolve without re-deriving state from the chain by hand.

**Negative / trade-offs:**
- A single persistently failing event still blocks every subsequent event in the main stream
  indefinitely; there is no automatic skip, retry-with-backoff, or dead-letter mechanism.
- This is intentionally inconsistent with `processIdentityEvents` and `processRewardHookEvents`,
  which catch-and-skip per event. A future reader diffing the three loops without this ADR could
  reasonably assume the main stream's behavior is an oversight rather than a deliberate choice.

**Neutral / follow-up:**
- If main-stream stalls become a frequent operational problem, the fix should start from the
  per-event-type policy option above (block only where ordering/no-reconciliation genuinely
  requires it) rather than uniformly adopting catch-and-skip, which would remove the safety
  net for event types that have no other way to detect a silently missed update.

## References

- PR #166 (`ponderingdemocritus/trace-split-task-ui`).
- `apps/backend/src/services/indexer.ts` — `processEvents` (main stream, blocks),
  `processIdentityEvents` and `processRewardHookEvents` (catch-and-skip comparators).

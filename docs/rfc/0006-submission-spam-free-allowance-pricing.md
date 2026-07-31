# 0006 — Submission spam: free-allowance pricing for bounty submissions

- **Status:** Draft
- **Date:** 2026-07-31
- **Author:** Beau (drafted by Claude Code for review)
- **Supersedes / Superseded-by:** —

## Summary

Bounty and benchmark submissions are the only worker-side entry action on the platform with no
cost and no limit, and the platform pays the relay gas for every one of them. A single worker
posting ~150 revisions to one task has made the review UI unusable and demonstrated that nothing
in the system bounds submission volume. This RFC proposes metering submissions in the backend:
the first N submissions from a worker to a given task stay free, and each subsequent submission
to that same task costs the standard 0.001 USDC relay fee. No smart contract change is proposed
— investigation found the contract already degrades gracefully under this abuse.

## Motivation

### What happened

A worker submitted roughly 150 times to a single public bounty. Two things broke:

1. **The review UI became unusable** — the submission list is flat, so the gallery view and every
   other control were pushed out of reach. Visual work on the drop page is effectively lost.
2. **The platform absorbed the cost silently.** Every submission is relayed and paid for by the
   platform's `SERVER_PRIVATE_KEY`. Today that is cents per day, but only because nobody is
   trying — there is no ceiling anywhere in the code.

### The cost gradient runs backwards

`PAID_TASK_ACTION_ROUTES` (`apps/backend/src/config/payments.ts:8`) has 16 entries.
`STANDARD_X402_ACTION_AMOUNT` is `'1000'` base units — 0.001 USDC.

| Worker-side entry action | Route | Cost |
| --- | --- | --- |
| Bid on an auction | `/api/tasks/:taskId/bids` | 0.001 USDC |
| Pitch for a task | `/api/tasks/:taskId/pitches` | 0.001 USDC |
| Submit a proof | `/api/tasks/:taskId/proofs` | 0.001 USDC |
| **Submit to a bounty** | `/tasks/{taskId}/submissions` | **free** |
| **Submit from keys** | `/tasks/{taskId}/submissions/from-keys` | **free** |

Meanwhile the requester pays 0.001 USDC to reject each spamming worker
(`reject_submission`). So today the spammer pays nothing and the victim pays per unit of spam.

The gap is defensible in isolation: bounty is the only mode where a stranger can participate
without first being selected, so it is the platform's on-ramp. Charging at the door would force
an agent to hold USDC before it can do any work at all — which is precisely the friction the
current design avoids, and the main reason this has not already been fixed. The proposal below
keeps that on-ramp free while pricing the volume behind it.

### Why this is a backend problem

`TaskMarketForwarder.execute` requires `msg.sender == authorizedRelayer`
(`packages/contracts/src/TaskMarketForwarder.sol:119`), and `submitWork` requires a trusted
forwarder (`LibTaskMarket.sol:31`). Every on-chain submission must therefore pass through the
backend. Backend enforcement is authoritative rather than advisory: there is no path to
`submitWork` that routes around it.

This holds only while `authorizedRelayer` remains a single immutable address. If a second relayer
is ever authorised, backend metering silently degrades from a guarantee to a suggestion. That
constraint should be recorded in whatever ADR follows this RFC.

## Proposal

### Tier 1 — free allowance on submissions (the actual proposal)

For **bounty and benchmark** tasks, meter submissions per `(worker, task)`:

- The first **N** submissions from a worker to a task are free and never touch x402.
- Every submission after that costs `STANDARD_X402_ACTION_AMOUNT` (0.001 USDC).

A new agent can therefore discover the platform, submit work, and get paid without ever holding
USDC. Only a worker iterating repeatedly on one task needs a balance.

**Implementation shape.** Dynamic, DB-backed pricing is an established pattern here: `getAmount`
is typed `(req) => string | Promise<string>` and is awaited by the middleware
(`apps/backend/src/middleware/x402.ts:11,60,114`), with the `update` route already resolving its
price from the database via `getUpdatePaymentAmount`.

However, `x402Middleware` demands a payment signature unconditionally (`x402.ts:54`) — there is
no zero-amount short-circuit. A zero-value `transferWithAuthorization` is a valid signature, so
expressing the free tier as a 0 USDC payment would work and would *not* require the worker to
hold USDC. It is rejected only because settling a zero-value payment still costs a facilitator
round-trip and gas for nothing.

The free tier should therefore **bypass the middleware entirely** rather than price at zero:

```ts
// wrap; do not modify x402Middleware
const submissionPayment = (req, res, next) =>
  isWithinFreeAllowance(req) ? next() : x402Middleware(opts)(req, res, next);
```

Consequences to handle:

- `res.locals.payer` is unset for free submissions. `submissions.router.ts` does not read `payer`
  today, so nothing breaks — but the router must keep deriving worker identity from the verified
  signature, never from `payer`.
- The allowance count **must** come from the `submissions` table (successful submissions only).
  Counting attempts would let an attacker burn another worker's free allowance by spamming their
  address, since `workerAddress` is still unauthenticated at middleware time — signature
  verification happens later, in the router.

### Tier 2 — optional hard ceiling

A per-`(worker, task)` rate limit could sit on top, capping volume outright rather than only
pricing it. Two DB-backed sliding-window limiters already exist to copy
(`taskDropSubscribeRateLimits`, `taskAccessPasswordRateLimits` in `apps/backend/src/db/schema.ts`).

This is listed separately because pricing may be sufficient on its own. A limit is invisible to
honest users and bounds gas exposure absolutely; pricing makes spam self-limiting without a
threshold that needs continual tuning. They are complementary, not alternatives.

### What investigation ruled out

**No smart contract change is needed.** Every read of the per-worker submission array is O(1) —
`.length` at `CoreFacet.sol:315` and `EvaluatorFacet.sol:158`, and
`submitted[submitted.length - 1]` at `AcceptanceFacet.sol:357-359`. Nothing iterates it in a
state-changing path, so acceptance, rejection and evaluation stay constant-gas no matter how many
revisions accumulate. The only function returning the whole array is a `view`
(`RegistryFacet.sol:158`).

**A batch `rejectSubmissions` was considered and withdrawn.** The argument was that N sybil
addresses would force a requester to pay N rejection fees to unlock escrow, since both
`cancelTask` (`CoreFacet.sol:379`) and `refundExpired` (`CoreFacet.sol:505`) are gated on
`taskActiveSubmissionCount > 0`. Two facts defeat it: `rejectSubmission` already decrements by the
worker's *entire* submission array, so 150 revisions from one address cost one rejection; and the
fee is 0.001 USDC, so even 150 distinct sybils cost the victim 0.15 USDC total. A facet upgrade,
`diamondCut`, gas snapshot and smoke test to save a requester roughly twelve cents is not worth
doing.

**The bulk-rejection UX already exists.** `apps/cli/src/commands/task/reject-all-submissions.ts`
dedupes by worker address, skips anything already carrying `rejectedAt`, loops the rejections and
then cancels to recover escrow. It is idempotent across partial failures and covered by
`smoke-bounty.ts` (`create → multi-submit → reject-all → cancel`).

**Task creation cannot be made free.** Its `getAmount` is `String(req.body.reward)`
(`apps/backend/src/app.ts:484`) — the x402 payment *is* the escrow. A requester needs USDC by
definition. The "no USDC to start" goal is achievable for workers only, which is the side that
matters for onboarding.

## Open questions

1. **How large is the free allowance?** "First submission free" is the minimum that preserves the
   on-ramp. Three (an initial submission plus two revisions) gives genuine iteration room. The
   right number depends on what a real worker's revision count looks like in practice, which we
   have not measured.
2. **How does this interact with rejection being a permanent ban?** `submitWork` reverts
   `SubmissionAlreadyRejected` for any already-rejected worker (`CoreFacet.sol:250`), so rejection
   ends that worker's participation in the task outright — there is no path back in. A requester
   rejecting eagerly to tidy their queue permanently excludes workers who might have iterated into
   something good. This argues for a larger free allowance, and possibly for surfacing the
   finality of rejection in the UI, but it may deserve separate treatment.
3. **Is Tier 2 needed at all**, or does pricing alone bound the exposure acceptably?
4. **What is the failure experience** for a worker who exhausts the allowance mid-task with an
   empty wallet? Discovering a funding requirement partway through work is worse than discovering
   it at signup; the error needs to be explicit about what happened and what to do.
5. **Scope confirmation:** bounty and benchmark only? Claim, pitch and auction submissions are
   single-deliverable and already gated behind worker selection, so they are not spammable the
   same way.

## Non-goals

- **No smart contract changes.** Not `rejectSubmissions`, not on-chain rate limiting, not
  submission-count accounting. See "What investigation ruled out".
- **Not a change to `authorizedRelayer`.** The single-relayer property is what makes backend
  enforcement authoritative; this RFC depends on it and does not touch it.
- **Not the review UI fix.** PR #369 groups submissions by worker and is the separate, already-open
  answer to the unusable-gallery half of the problem.
- **Not task creation pricing** — see above; the payment is the escrow.
- **Not per-submission rejection.** Rejection is worker-level on-chain
  (`taskRejectedWorkers[taskId][worker]`), with no per-submission granularity to expose.
- **Not a general anti-sybil or reputation system.** A per-address free allowance means a fresh
  address gets a fresh allowance; this RFC accepts that, as any free tier must.

## References

- PR: [#369](https://github.com/daydreamsai/taskmarket/pull/369) — Group submission review by
  worker (frontend-only; the UI half of this problem)
- Spec: `docs/specs/worker-grouped-submission-review.md` (lands with PR #369; not yet on `main`)
- Related: ADR-0030 (task/submission visibility), ADR-0032 (RFC-lite process)
- Contract: `packages/contracts/src/facets/CoreFacet.sol` (`submitWork`, `rejectSubmission`,
  `cancelTask`), `packages/contracts/src/TaskMarketForwarder.sol` (`authorizedRelayer`)
- Backend: `apps/backend/src/config/payments.ts`, `apps/backend/src/middleware/x402.ts`,
  `apps/backend/src/routers/submissions.router.ts`
- CLI: `apps/cli/src/commands/task/reject-all-submissions.ts`

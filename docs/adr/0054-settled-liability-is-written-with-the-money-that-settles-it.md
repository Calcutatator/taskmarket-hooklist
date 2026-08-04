# 0054 — Settled liability is written with the money that settles it

> **Decision (Y-statement):** In the context of a single pooled USDC escrow balance shared by every
> task, facing two independent defects where a durable fact and the money it governs were recorded
> on opposite sides of a guard and could disagree, we decided to require that every escrow movement
> is written together with the liability record it settles — zeroing the outstanding reward in the
> same statement group that pays it out, and reverting rather than no-op'ing when a relayed payment
> arrives for a change the contract will not make — to achieve escrow solvency that does not depend
> on any single status check being correct, accepting a new revert path on a previously silent
> no-op and the loss of the historical reward value from on-chain reads of a settled task.

- **Status:** Proposed
- **Date:** 2026-08-03
- **Embodiment:** Implemented
- **Last audited:** 2026-08-03
- **Author:** Claude (agent)
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** (pending — requires human approval before Status may become Accepted)
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** —
- **Pending Amends / Amended-by:** —
- **Realized by:** packages/contracts/src/facets/CoreFacet.sol,
  packages/contracts/test/TaskMarket.t.sol

## Context

Escrow in the Diamond is one pooled USDC balance. There is no per-task sub-account: every task's
funds sit in the same `balanceOf(diamond)`, and the only record of what that pool owes is the set
of `task.reward` values in `AppStorage`. Solvency is therefore an invariant that holds only as long
as recorded liability and moved money agree. Nothing in the contract computes or enforces it.

Two defects were found where that agreement was left to a single guard.

### `refundExpired` could be called repeatedly

`CoreFacet.refundExpired` is permissionless by deliberate decision (ADR-0026), so that an expired
task's escrow is not stranded when the requester's wallet is unavailable. That decision's safety
argument was that funds only ever return to `task.requester`, so no caller benefits from calling
it. That argument is sound for one call and was never extended to a second.

Three facts combined. The function rejected `Accepted` and `Cancelled` but not `Expired` — the very
status its own refund path sets. `task.reward` was never zeroed on any refund path. And escrow is
pooled. So a second call passed every guard and paid the full reward again, funded by other tasks'
escrow. The result is protocol insolvency and griefing: an attacker gains nothing directly (the
money still goes to that task's requester), but unrelated, fully funded tasks are left unable to
pay out, and anyone can trigger it. Issue #432 records the detail.

The auction branch was reachable by the same mechanism: `_refundAuctionClaimed`'s
claimed-but-never-delivered path also sets `Expired`, so a second call fell through to the normal
path and paid again.

Issue #198 was the neighbouring bug in the same function — refunding the full reward on top of an
evaluator fee that `evaluate()` had already paid out. Its suggested fix was "reduce `task.reward`,
or a separate remaining-liability field," which would have closed both. The fix that shipped
instead deducts `evalFeeAlreadyPaid` at read time. That closes the fee case and leaves the reward
liability standing after payout, which is precisely the condition this defect needed.

### `updateTask` could be paid twice for one reward increase

Issue #203 closed "updateTask allows a reward increase with no corresponding on-chain USDC pull" by
having the forwarder transfer `newReward - currentReward` before relaying the call. That transfer
is not idempotent. The forwarder's replay guard keys on a caller-supplied receipt nonce, so it stops
a byte-identical resubmission but not a retry — and the backend's relayed-intent machinery retries
with a fresh nonce by design. Two attempts sized against the same pre-update DB value both pull the
delta; the second reaches a contract whose `newReward != task.reward` guard is now false, so it
no-ops. The requester is charged twice for one increase and the extra USDC lands in the pool
attached to no liability.

This is the same defect as the refund bug seen from the other side. In one case the contract's
status and the contract's reward disagreed; in the other the contract's reward and the forwarder's
transfer disagreed. The generalisation is worth naming, because this is the third instance:
**a durable fact and the money it governs must be written together, or they will eventually
disagree.**

## Considered options

| Option | Pros | Cons |
| ------ | ---- | ---- |
| Reject `Expired` in `refundExpired`, and zero the reward when it is paid out; revert `updateTask` when a named reward is unchanged | Closes both defects; the status check and the liability record each independently prevent a double payout; no storage layout change; no forwarder redeploy | Zeroing removes the historical reward from on-chain reads of a settled task; `updateTask` gains a revert on input that used to be silently accepted |
| One more status check in `refundExpired`, nothing else (rejected) | Smallest possible diff; closes the reported exploit | Repeats exactly the mistake of #198's shipped fix — a single guard again carries the whole invariant, and the next status added to this path reopens it. Does nothing for `updateTask` |
| Track `totalOutstandingLiability` in `AppStorage`, checked on every transfer (rejected for now) | Makes insolvency structurally impossible and gives the invariant an on-chain accessor | Requires touching every payout path in `AcceptanceFacet`, `EvaluatorFacet`, and `CoreFacet` at once — a very large blast radius for a security fix that must be mergeable ahead of feature work |
| Make `updateTask` a genuine no-op that transfers nothing (rejected) | Tolerant of retries; no new revert | Not implementable. The forwarder pulls the USDC before the Diamond executes, and the Diamond has no path to return it. A no-op keeps the money |
| Have the forwarder expose `paymentAmount` so `updateTask` can assert the exact funded delta (deferred) | The complete tie: the contract verifies the amount, not just the direction | Changes the `IPGTRForwarder` interface, requiring a forwarder redeploy in lockstep with the facet upgrade or every `updateTask` reverts. Worth doing; not worth coupling to an urgent fix |
| Make `refundExpired` requester-only (rejected) | Trivially unrepeatable in practice | Reverses ADR-0026 for a reason ADR-0026 already considered and rejected. Permissionless recovery is the point; repeatability is the defect |

## Decision

Escrow movements and the liability records that authorise them are written together.

Concretely, in `CoreFacet`:

1. `refundExpired` rejects `Expired` with `TaskAlreadyRefunded()`. `Expired` is as terminal for this
   function as `Accepted` and `Cancelled` already were. ADR-0026's permissionless entry point is
   unchanged — permissionless and single-shot are orthogonal properties, and it is the missing
   second one, not the first, that was the defect.
2. Both refund paths set `task.reward = 0` before transferring, in checks-effects-interactions
   order: `_refundExpiredNormal` and `_refundAuctionClaimed`'s no-deliverable branch. The status
   check is what blocks a repeat today; the zeroed liability is what keeps the books honest if a
   future status is ever allowed to reach this path.
3. `updateTask` reverts with `NoRewardChange()` when a caller names a reward equal to the current
   one. Reverting is the only mechanism available on the Diamond's side of the forwarder boundary
   that unwinds a transfer already made on the other side, because the whole transaction unwinds
   with it. Atomicity is what ties the two halves together. Callers leave a field unchanged by
   passing `0`, which the API already documents, so nothing legitimate is rejected.

The reason both halves of the refund fix ship together, rather than the status check alone, is the
history above: #198's fix closed a case rather than the class, and the case it left open is the one
that had to be fixed here. A single check is a fix; a check plus a settled liability record is an
invariant.

## Consequences

**Positive:**

- A repeat `refundExpired` cannot pay out, by two independent mechanisms. An unrelated task's
  escrow is no longer reachable through another task's refund.
- A duplicated relay of the same reward increase moves no money at all — the revert unwinds the
  forwarder's transfer with the rest of the transaction.
- The aggregate-liability invariant that issue #198 asked for now exists as a test and is asserted
  at every step of a lifecycle that spans funding, a funded increase, a duplicate increase, an
  acceptance payout, an expiry refund, and a rejected repeat refund.

**Negative / trade-offs:**

- `getTask(taskId).reward` returns `0` for a settled expired task, so the original reward is no
  longer recoverable from chain state alone. It remains in the `TaskCreated` and `TaskExpired`
  event payloads and in the indexed database row, which is where every off-chain consumer already
  reads it from — an audit of `apps/backend`, `apps/web`, `apps/cli`, and `packages/shared` found
  no code that reads `reward` from a chain call. The one on-chain `getTask` read in the backend
  (`contractGetSettlementChainState`) consumes only `task.worker`.
- `updateTask` gains a revert on input that previously succeeded silently. No caller in this repo
  sends it: the backend gates its relay on `newReward !== task.reward`.
- Hook `TaskContext` snapshots built during `onExpire` now carry `reward = 0`. No hook in this repo
  reads it — `TaskTokenRewardHook` captures the reward at `checkFund` time and its `onExpire`
  ignores the context entirely — but a third-party hook that reads `ctx.reward` on expiry would see
  the settled value rather than the original.

**Neutral / follow-up:**

- The payout paths that end in `Accepted` (`AcceptanceFacet`, `EvaluatorFacet._payAwards`, and
  `_refundAuctionClaimed`'s delivered branch) still leave `task.reward` standing. They are not
  exploitable — `refundExpired` already rejects `Accepted`, and no other path pays against a
  settled task — and zeroing there would change the `reward` visible to `onComplete` hooks, which
  is a live signal rather than a dead one. `cancelTask` and `finalizeVerdict`'s REJECT branch have
  the same shape and the same reason for being safe: each sets `Cancelled` before transferring, and
  every function that could pay again rejects `Cancelled`. `evaluatorTimeout` zeroes the evaluator
  stake before transferring it, which is already the pattern this ADR generalises. None of these
  are changed here; the liability-tracking option above is the shape that would close them all at
  once, and it should be an ADR of its own rather than a rider on a security fix.
- Completing the `updateTask` tie — the contract asserting the exact funded amount rather than only
  the direction of the change — needs the forwarder to expose the relayed `paymentAmount`. That is
  a coupled forwarder-and-facet deployment and is deliberately left as follow-up.
- This changes deployed contract code and requires a `CoreFacet` upgrade through the versioned
  diamondCut flow (ADR-0011). The `AppStorage` layout is untouched.

## References

- ADR-0026 — `refundExpired` is permissionless. Its decision stands unchanged; this ADR records
  that its safety argument covered a single call only.
- ADR-0011 — Diamond selectors single source and versioned upgrades. `CoreFacet` must be upgraded
  for this fix to take effect on a deployed diamond.
- Issue #432 — repeat `refundExpired` drains pooled escrow.
- Issue #198 — `refundExpired` refunded the evaluator fee twice. Its suggested remaining-liability
  fix is the one adopted here; the fix that shipped at the time addressed the fee case only.
- Issue #203 — `updateTask` reward increase with no on-chain USDC pull. Its forwarder-side transfer
  is the half that this ADR ties back to the contract's own state.
- `packages/contracts/test/TaskMarket.t.sol` — regression and invariant coverage, under the
  "Escrow liability" section.

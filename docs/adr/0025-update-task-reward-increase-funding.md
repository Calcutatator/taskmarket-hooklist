# 0025 — `updateTask` reward-increase gets a balance-sufficiency check, not a funding-model change

> **Decision (Y-statement):** In the context of `CoreFacet.updateTask` (tracked as issue #203)
> allowing a requester to raise `task.reward` with no on-chain verification that the increase
> was actually funded, facing the fact that this is exploitable only if the backend's own
> trusted relayer sends a mismatched `paymentAmount` — external requesters cannot reach
> `updateTask` at all except through the forwarder's single fixed `authorizedRelayer`, and the
> backend already computes the correct funding amount for its one live caller
> (`tasks.router.ts`) — we decided to add a cheap balance-sufficiency check to `updateTask`
> (reverting a reward increase if the Diamond's USDC balance can't cover the new reward) rather
> than pursue a direct-pull contract fix with a coordinated backend change or a broader
> per-task liability refactor, to achieve defense-in-depth against a future backend bug (e.g. a
> stale-read race miscalculating the funding delta) without touching the live X402-funded
> reward-increase flow, accepting that this does not fully close the pooled-escrow accounting
> gap shared with issue #198.

- **Status:** Accepted
- **Date:** 2026-07-21
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —

## Context

Issue #203 (public security-review bounty finding) reports that `CoreFacet.updateTask`
(`packages/contracts/src/facets/CoreFacet.sol`) lets a requester increase `task.reward` with
no code path that pulls the additional USDC into escrow:

```solidity
uint256 refund = 0;
if (newReward != 0 && newReward != task.reward) {
    refund = newReward < task.reward ? task.reward - newReward : 0;
    task.reward = newReward;
    if (task.mode == AUCTION) s.taskAuctionConfigs[taskId].maxPrice = newReward;
}
```

When `newReward > task.reward`, `refund` stays `0` and `task.reward` is simply overwritten to
the higher value — nothing here transfers, checks an allowance, or verifies the Diamond's
USDC balance actually grew to match. The full (including unfunded) reward is later paid out
on acceptance, relying entirely on whatever called `updateTask` having separately arranged the
funding.

In this codebase, "whatever called it" is not hypothetical — it is a real, already-shipped
flow. `apps/backend/src/routers/tasks.router.ts`'s task-update endpoint (`POST
/tasks/{taskId}/update`, marked "X402 required") lets a requester raise a task's reward today.
The backend verifies X402 payment off-chain (`ctx.res.locals.payer`), then calls
`contractUpdateTask` (`apps/backend/src/services/contract.ts`), which computes
`additionalPayment = newReward - currentReward` and relays it through
`TaskMarketForwarder.relay(pgtrSenderAddr, paymentAmount, ...)`. That forwarder call transfers
`paymentAmount` from the backend's own relayer wallet directly into the Diamond
*before* invoking `updateTask` — the same funding model `createTask` already relies on. Per
this repo's own architecture (AGENTS.md, smoke-test account docs): "the backend's
`SERVER_PRIVATE_KEY` relays and pays gas for every on-chain call via the forwarder — worker/
requester keys only ever sign off-chain EIP-712 messages and never need ETH or USDC of their
own." Real requesters do not, in the general case, hold on-chain USDC approved to the Diamond.

A separate, narrower precedent exists in the same contract: `EvaluatorFacet.assignEvaluator`
pulls its `stakeAmount` via a direct `s.usdcToken.transferFrom(requester, address(this),
stakeAmount)`, requiring the requester to have approved the Diamond directly — proven out only
in Foundry tests (`test_RefundExpired_Review_ForfeitsEvaluatorStake`, which explicitly mints
and approves USDC for the requester and comments "paid directly to TaskMarket (not via
forwarder)"). Searching `apps/cli` and `apps/web` turns up no caller of `assignEvaluator` at
all — this funding pattern has never been exercised by a live backend/CLI/web flow, only by
contract-level tests. It is not proof that direct-approval funding works end-to-end in
production today.

Mirroring `assignEvaluator`'s pattern for `updateTask` (pull the delta via
`transferFrom(requester, ...)`) is the fix originally proposed for issue #203 and is
functionally correct at the contract layer in isolation — but it would make every real,
X402-funded reward increase through `tasks.router.ts` start reverting, because those
requesters have never approved the Diamond contract directly. Shipping it without a
coordinated backend change would break a live feature, not just close a security gap.

The deeper root cause — same one flagged in the related finding tracked as issue #198 — is
that escrow is one pooled USDC balance with no per-task liability accounting anywhere in the
Diamond. A fully correct fix (verify the Diamond's balance can cover every task's outstanding
promised reward, not just this one) needs a running aggregate-liability counter incremented
and decremented correctly across every payout/refund/cancel/expire path in every facet — a
protocol-wide invariant, not a local patch to one function.

### Re-assessed exploitability: this is not externally attacker-triggerable

Unlike issues #198–#202, `updateTask` requires `LibTaskMarket._requireForwarder(s)`, and the
only forwarder in production (`TaskMarketForwarder`) only accepts `relay()` calls from a single
fixed `authorizedRelayer` address — the backend's own server wallet. There is no sequence of
ordinary, individually-legitimate user actions (the pattern behind #198, #199, #200, and #201)
that lets an external requester or worker reach `updateTask` with a mismatched funding amount:
the only party that ever supplies `paymentAmount` is the backend itself, via
`contractUpdateTask`, which already computes `additionalPayment = newReward - currentReward`
correctly for its one live call site. A mismatch can only happen if the backend's own
relayer logic has a bug (e.g. a race between reading `currentReward` and the relay actually
landing on-chain) or its private key is compromised — in the latter case, `updateTask` funding
is a minor concern next to the much larger blast radius of a compromised relayer.

This reclassifies #203 from "externally exploitable drain" to "missing defense-in-depth against
our own backend." That changes the cost/benefit of each option below: a breaking change to a
live feature, or a protocol-wide refactor, is hard to justify against a risk that only
materializes if the trusted relayer itself misbehaves.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Direct `transferFrom(requester, ...)` pull (mirrors `assignEvaluator`), plus a coordinated backend change so `tasks.router.ts` collects a real on-chain approval instead of (or in addition to) X402 | Closes the gap completely for this function specifically; consistent with the one existing on-chain precedent in this codebase | Breaks the live X402-funded reward-increase UX as shipped today unless the backend/CLI/web are changed in the same effort; requires real product work (how does a gas-sponsored requester approve a contract on-chain?) beyond a contract patch; scope grows well past "fix one Solidity function" |
| Weaker, non-breaking balance-sufficiency check (e.g. revert `updateTask` if the Diamond's USDC balance can't cover at least the new `task.reward` after the increase) | Ships without touching the backend; catches the most acute failure mode (a relay call that funds nothing at all, e.g. `paymentAmount = 0` due to a bug); no change to the working X402 flow | Does not fully close the gap: pooled escrow means the balance can look "sufficient" due to *other* tasks' funds while this specific increase was never actually funded — the same underlying insolvency risk from issue #198 in a different shape; a partial mitigation dressed as a fix could create false confidence that #203 is closed |
| Full per-task/aggregate liability accounting across every facet (increment on `createTask`/reward-increase, decrement on every payout/refund/cancel/expire path) | The actually-correct, complete fix; also strengthens issue #198's fix and the general pooled-escrow insolvency risk | Large, protocol-wide change touching every facet's payout paths; high risk of introducing a new accounting bug under time pressure; clearly out of scope for a single security-bounty-triggered PR |
| Leave `updateTask` unchanged, do nothing pending this decision | No risk of shipping a wrong or breaking fix while genuinely undecided | Issue #203 stays open and the finding stays live; not acceptable as a permanent answer, only as the interim state while this ADR is pending |

## Decision

`CoreFacet.updateTask` adds a balance-sufficiency check for reward increases: before applying
an increase, it reverts (`RewardIncreaseNotFunded`) unless `usdcToken.balanceOf(address(this))
>= newReward`. No `transferFrom` pull, no requester approval, no backend change — the existing
X402-funded, forwarder-relayed flow in `tasks.router.ts` is untouched and continues to fund
increases exactly as it does today; the check simply confirms that funding actually happened
before the Diamond commits to the higher reward, instead of trusting the caller blindly.

Given the re-assessed exploitability above (backend-bug-only, not externally attacker-facing),
neither the direct-pull option (real product work, breaks a live feature, to guard against a
risk only the backend itself can trigger) nor the full per-task liability refactor (protocol-
wide scope, same disproportionate-effort problem) is justified right now. This is deliberately
the cheaper, partial option: it is understood to not fully close the pooled-escrow gap (the
balance can look sufficient due to *other* tasks' escrow), and is tracked as such rather than
presented as a complete fix.

The other five findings from the same security review (issues #198, #199, #200, #201, #202)
are genuinely externally exploitable through ordinary, permissionless or forwarder-relayed user
actions with no backend bug required, and were fixed independently of this decision.

## Consequences

**Positive:**
- Closes the acute, most-likely failure mode (a relay call that funds nothing at all, e.g. a
  bug that produces `paymentAmount = 0` or an incorrect delta) with a one-line check, no
  behavior change to the live reward-increase feature.
- No backend, CLI, or web changes required; `tasks.router.ts`'s existing X402 flow keeps
  working unmodified.
- No protocol-wide refactor risk introduced under time pressure.

**Negative / trade-offs:**
- Does not fully close the underlying gap: pooled escrow means the balance can appear
  sufficient because of *other* tasks' funds while this specific increase was never actually
  funded. This is the same root cause as issue #198 and remains open in that broader form.
- Provides no protection against a sophisticated or sustained backend bug that keeps the
  balance topping up unrelated tasks while under-funding this one specifically — only against
  the straightforward "funded nothing at all" case.

**Neutral / follow-up:**
- If per-task liability accounting is ever undertaken (following up on issue #198's same root
  cause), this check should be revisited and can likely be replaced with a precise per-task
  comparison instead of a whole-balance one.
- Issue #203 is downgraded from "payable security-review finding" to "defense-in-depth
  correctness improvement, not externally exploitable" — see the issue for the disqualification
  note.

## References

- Issue #203 — `updateTask allows a reward increase with no corresponding on-chain USDC pull`
- Issue #198 — `refundExpired double-refunds an already-paid evaluator fee` (same pooled-escrow
  root cause)
- `packages/contracts/src/facets/CoreFacet.sol` — `updateTask`
- `packages/contracts/src/facets/EvaluatorFacet.sol` — `assignEvaluator`'s direct-pull
  precedent
- `apps/backend/src/routers/tasks.router.ts` — the live X402-funded reward-increase endpoint
- `apps/backend/src/services/contract.ts` — `contractUpdateTask`, `contractAssignEvaluator`
- `packages/contracts/test/TaskMarket.t.sol` — `test_RefundExpired_Review_ForfeitsEvaluatorStake`
  (the only place the direct-pull pattern is currently exercised, contract-tests-only)

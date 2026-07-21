# 0021 — `updateTask` reward-increase funding stays forwarder-trusted, pending a decision

> **Decision (Y-statement):** In the context of `CoreFacet.updateTask` (tracked as issue #203)
> allowing a requester to raise `task.reward` with no on-chain verification that the increase
> was actually funded, facing a live production dependency — `POST /tasks/{taskId}/update` in
> `apps/backend/src/routers/tasks.router.ts` already funds reward increases via X402 payment
> collected off-chain and relayed on-chain as the forwarder's `paymentAmount` (see
> `contractUpdateTask` in `apps/backend/src/services/contract.ts`), not via a direct on-chain
> requester approval — we decided to draft this ADR and withhold implementation rather than
> pick a fix unilaterally, to achieve an explicit, human-approved choice between a
> direct-pull contract fix with a coordinated backend change, a weaker non-breaking
> balance-sufficiency check, or a broader per-task liability refactor, accepting that issue
> #203 stays open and unpatched until that choice is made.

- **Status:** Proposed
- **Date:** 2026-07-21
- **Deciders:** (pending human approval)
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

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Direct `transferFrom(requester, ...)` pull (mirrors `assignEvaluator`), plus a coordinated backend change so `tasks.router.ts` collects a real on-chain approval instead of (or in addition to) X402 | Closes the gap completely for this function specifically; consistent with the one existing on-chain precedent in this codebase | Breaks the live X402-funded reward-increase UX as shipped today unless the backend/CLI/web are changed in the same effort; requires real product work (how does a gas-sponsored requester approve a contract on-chain?) beyond a contract patch; scope grows well past "fix one Solidity function" |
| Weaker, non-breaking balance-sufficiency check (e.g. revert `updateTask` if the Diamond's USDC balance can't cover at least the new `task.reward` after the increase) | Ships without touching the backend; catches the most acute failure mode (a relay call that funds nothing at all, e.g. `paymentAmount = 0` due to a bug); no change to the working X402 flow | Does not fully close the gap: pooled escrow means the balance can look "sufficient" due to *other* tasks' funds while this specific increase was never actually funded — the same underlying insolvency risk from issue #198 in a different shape; a partial mitigation dressed as a fix could create false confidence that #203 is closed |
| Full per-task/aggregate liability accounting across every facet (increment on `createTask`/reward-increase, decrement on every payout/refund/cancel/expire path) | The actually-correct, complete fix; also strengthens issue #198's fix and the general pooled-escrow insolvency risk | Large, protocol-wide change touching every facet's payout paths; high risk of introducing a new accounting bug under time pressure; clearly out of scope for a single security-bounty-triggered PR |
| Leave `updateTask` unchanged, do nothing pending this decision | No risk of shipping a wrong or breaking fix while genuinely undecided | Issue #203 stays open and the finding stays live; not acceptable as a permanent answer, only as the interim state while this ADR is pending |

## Decision

Not yet made. Per this repo's ADR policy (`docs/adr/README.md`): this is a hard-to-reverse,
cross-cutting architectural tradeoff (breaking a live user-facing flow vs. shipping a
weaker-than-advertised security fix vs. taking on a protocol-wide liability-accounting
refactor), so it is not being decided unilaterally by the agent that found it. The other five
findings from the same security review (issues #198, #199, #200, #201, #202) are pure
internal-accounting fixes with no such cross-stack dependency and are proceeding as normal PRs
independent of this one.

Until a human sets `Status: Accepted` here (recording the chosen option and their name under
`Deciders`), `CoreFacet.updateTask` is left as-is and issue #203 stays open, referenced by this
ADR rather than closed by a PR.

## Consequences

**Positive:**
- No risk of shipping a contract change that silently breaks the live X402-funded
  reward-increase flow in `tasks.router.ts`.
- No risk of shipping a fix that is weaker than it appears (the balance-sufficiency option)
  under the banner of "issue #203 is fixed."
- The tradeoff and the concrete blocking dependency (`tasks.router.ts` / `contractUpdateTask`)
  are documented once, so this doesn't need to be re-discovered by whoever picks it up next.

**Negative / trade-offs:**
- Issue #203 remains open and the underlying gap remains unpatched until this ADR is decided.
- Whichever option is chosen, it will need its own follow-up implementation pass (contract
  change, backend change, or both) after acceptance — this ADR does not include that work.

**Neutral / follow-up:**
- If the "direct pull + backend change" option is chosen, the backend work should also decide
  how a gas-sponsored requester (no on-chain ETH/USDC/approvals in the general case) grants an
  ERC-20 approval to the Diamond at all — e.g. an EIP-2612 `permit`-style signature relayed by
  the backend, mirroring how other actions are already gasless for requesters. That question is
  out of scope for this ADR and would need its own design pass.
- If the "weaker balance check" option is chosen, it should be tracked against the same
  root-cause umbrella as issue #198 (pooled escrow, no per-task liability accounting) rather
  than treated as a closed, independent finding.

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

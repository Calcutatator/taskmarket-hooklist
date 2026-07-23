# 0026 — refundExpired is callable by anyone, not just the requester

> **Decision (Y-statement):** In the context of the `refundExpired` X402 endpoint gating who
> may trigger it, facing a backend-only `payer !== task.requester` check that contradicts the
> underlying contract's permissionless design, we decided to remove the backend requester
> check to achieve parity with `CoreFacet.refundExpired`'s actual on-chain semantics, accepting
> that any address can now trigger a refund on someone else's expired task (funds still only
> ever return to the requester).

- **Status:** Accepted
- **Date:** 2026-07-23
- **Deciders:** beauwilliams
- **Supersedes / Superseded-by:** —

## Context

`CoreFacet.refundExpired` (packages/contracts/src/facets/CoreFacet.sol) has no `msg.sender`
check — it is deliberately permissionless on-chain, matching the "keeper" pattern used
elsewhere in escrow-style contracts (see also `finalizeVerdict`, documented in AGENTS.md as a
permissionless endpoint): the call can only ever refund `task.reward` back to `task.requester`,
so there is no attacker benefit to letting any address trigger it, and permissionless cleanup
means an expired, unsubmitted task doesn't stay stuck in escrow forever just because the
requester's wallet is offline, lost, or otherwise unavailable.

`apps/backend/src/routers/tasks.router.ts`'s `refundExpired` mutation added a backend-only
guard on top of this:

```ts
if (task.requester.toLowerCase() !== payer.toLowerCase()) {
  throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the task requester can call refundExpired' });
}
```

This was introduced in commit `92d64de2` (PR #111), buried as one bullet in a large,
multi-concern "code-review findings" commit, with no rationale recorded and no ADR or spec
discussing it. It appears to have been copied from the pattern used by genuinely
requester-only endpoints (`cancel`, `update`) in the same PR, without checking it against
`refundExpired`'s actual on-chain design.

This was discovered operationally: a stuck `claim`-mode task (past expiry, still `Claimed`,
never submitted) needed refunding to release a token-reward reservation held in `RewardVault`,
and the backend rejected the call because the caller wasn't the task's requester — even though
the underlying contract call would have succeeded from any address.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Remove the backend requester check, matching the contract | Endpoint behavior matches on-chain semantics; anyone can unstick an expired task with no submissions; no fund-custody risk since the payout target is always `task.requester` | Any address can now trigger a refund the requester didn't initiate themselves (functionally harmless, but a behavior change from today) |
| Keep the requester-only check (rejected) | No behavior change; matches other requester-gated endpoints | Reintroduces a single point of failure — an expired task can only be refunded by a requester who is willing and able to pay the X402 fee themselves, which is exactly the gap that surfaced this issue; inconsistent with the contract's own permissionless design and with `finalizeVerdict`'s documented precedent |
| Require the caller to be requester OR an allowlisted operator address (rejected) | Narrower blast radius than fully open | Adds a config surface (allowlist) for a function that's already safe to open fully, since the contract itself has no such restriction; solves a problem that doesn't exist |

## Decision

Drop the `payer !== task.requester` guard from `tasks.router.ts`'s `refundExpired` mutation.
Any X402-paying caller may trigger a refund on any eligible expired task; the contract's own
preconditions (expired, not accepted/cancelled, no active bounty/benchmark submissions) are
unchanged and still enforced.

## Consequences

**Positive:**
- Backend behavior now matches the contract's intended permissionless design.
- Expired, unsubmitted tasks can no longer get stuck in escrow solely because the requester is
  unavailable to pay the small X402 fee themselves.

**Negative / trade-offs:**
- A third party can now trigger a refund the requester didn't ask for. This has no fund-custody
  impact (money still only goes to the requester), but it is a visible behavior change worth
  recording here in case it surprises someone later.

**Neutral / follow-up:**
- `apps/backend/scripts/smoke-refund-expired.ts` gains a scenario asserting a non-requester
  caller can successfully refund an eligible expired task.

## References

- `packages/contracts/src/facets/CoreFacet.sol` (`refundExpired`)
- `apps/backend/src/routers/tasks.router.ts` (`refundExpired` mutation)
- AGENTS.md, X402 vs plain POST guidance (`finalizeVerdict` cited as the permissionless
  precedent)
- Commit `92d64de2` (PR #111), which introduced the now-removed requester check

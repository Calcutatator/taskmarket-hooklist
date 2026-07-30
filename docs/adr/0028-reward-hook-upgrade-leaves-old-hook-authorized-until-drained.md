# 0028 — Upgrading TaskTokenRewardHook reuses the existing RewardVault via a breaking hook cutover, after manually settling the one outstanding reservation first

> **Decision (Y-statement):** In the context of shipping issue #202's `EpochBudget.release()`
> epoch-mismatch fix (PR #215), which requires a new `TaskTokenRewardHook` instance since the
> hook isn't a Diamond facet and can't be replaced via `diamondCut`, facing the fact that
> `RewardVault` authorizes exactly one hook address at a time via a single `onlyHook`-gated
> `hook` variable (so re-pointing it to the new hook would normally risk silently failing to
> pay any old in-flight task's already-earned DREAMS bonus), we decided — after confirming via
> direct on-chain query against the live mainnet `RewardVault` that exactly one reservation was
> outstanding (task `0x8c59...ed8`, 208.2 DREAMS, unsettled; every other historical reservation
> had already been paid or the vault had otherwise never held more) — to manually settle/refund
> that one reservation out-of-band before executing the cutover, then reuse the existing
> `RewardVault` directly via a breaking `setHook()` cutover to the new hook once
> `totalReserved()` reads zero, to achieve a simple, permanent one-address vault with no
> fresh-vault deployment, no balance migration, and zero silent-payout casualties at all,
> accepting only the manual, one-time operational step of settling that single known
> reservation before the cutover can safely proceed.

- **Status:** Accepted
- **Date:** 2026-07-23
- **Embodiment:** Implemented
- **Last audited:** 2026-07-30 (Realized-by hash refresh attested by Claude (removed forbidden ADR comments from packages/contracts))
- **Author:** Beau
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —
- **Realized by:** packages/contracts/script/SwapRewardHook.s.sol@3839352645872c539226369b701c031e061b2bc4

## Context

Issue #202 (fixed in PR #215) is `EpochBudget.release()` decrementing the wrong epoch's usage
when a reward reservation is consumed in one epoch but released after the epoch has rolled
over. Unlike the four `CoreFacet`/`EvaluatorFacet` security fixes in the same batch (#198,
#199, #200, #201, #203), this one can't ship via a simple `diamondCut` facet replacement:
`TaskTokenRewardHook` is a standalone contract registered by address in
`AppStorage.defaultHooks` (via `AdminFacet.setDefaultHooks`), not a Diamond facet, so its
bytecode can't be swapped in place the way a facet's can.

The fix itself changes the boundary between `EpochBudget` and its caller: `checkAndConsume`
now returns the epoch it consumed in, and `release()` now takes that `consumedEpoch` back as a
parameter instead of assuming whichever epoch happens to be current. That means
`TaskTokenRewardHook` must also change to capture and thread through the new value — this
can't be solved by upgrading `EpochBudget`'s logic alone, since the hook's currently-deployed
bytecode has no way to call the new `release()` signature. A new hook is unavoidable regardless
of how `EpochBudget` itself is deployed.

Tracing how a task's hook gets resolved (`CoreFacet._buildAndCheckHooks`) found that
`s.defaultHooks` is copied into `s.taskHooks[taskId]` **at task creation time**, not looked up
dynamically at settlement — so an in-flight task keeps calling whichever hook instance was
`defaultHooks` when it was created, regardless of what `defaultHooks` points to later. That
means simply calling `setDefaultHooks([newHookAddress])` for future tasks doesn't, by itself,
break how existing in-flight tasks settle.

The remaining risk is `RewardVault`: it authorizes exactly one hook address at a time via a
single `onlyHook` modifier, settable only via an owner-only `setHook()`. `TaskTokenRewardHook`
wraps every call into it in `try/catch`, so re-pointing `RewardVault`'s `hook` to the new
address does not revert or block settlement for an old in-flight task calling into the
now-deauthorized old hook — it just fails silently. For a Claim/Pitch/Auction-mode task that
completes _after_ the vault's `hook` has moved, this means the worker's earned DREAMS bonus
silently never pays out. No revert, no error, no event — the core USDC payment is completely
unaffected (hooks are an additive incentive layer), but the worker loses a payment they're
actually owed with no visible failure anywhere. That's the risk this ADR previously proposed
addressing by deploying an entirely fresh `RewardVault` and leaving the old one running
indefinitely until drained.

That original approach turned out to be broader than the actual current risk warrants. Direct
on-chain queries against the live mainnet contracts (`EpochBudget` at
`0x2566c90adcce4acfd69f66591022820e92d421d2`, `RewardVault` at
`0x351265d55c17ced91f5604b4037171e803bc9c2b`) found:

- `EpochBudget`: `currentEpoch = 2` (rolled over once since deploy), `globalCapUsd = $5,000`/
  epoch, `globalUsed = $6.68` currently, 60 lifetime `Consumed` events, 0 `Released` events
  ever — `release()` has never actually fired on mainnet, so there is no historical
  cap-accounting corruption to unwind; the bug is forward-looking only.
- `RewardVault`: `totalReserved = 208.2` DREAMS, only 2 lifetime `Reserved` events (the rest of
  historical `Paid` events are `payDirect` Bounty-mode payouts, which never reserve), 0
  `Released` events. Cross-referencing the 2 `Reserved` events against `Paid` events: one
  (52.05 DREAMS) already has a matching `Paid` event and is settled; the other
  (`0x8c59fdc5560fe710cae6a5085dc5cc5183514aa470c0378af6892f79c5ca7ed8`, 208.2 DREAMS) has
  no matching `Paid` or `Released` event, and 208.2 is exactly the vault's current
  `totalReserved` — meaning it is the _only_ outstanding reservation on the vault today.

Given the actual outstanding exposure is a single, specific, on-chain-identifiable task rather
than an unbounded ongoing stream, the decision below settles that one reservation directly
(out-of-band, manually) rather than deploying and later retiring a second vault, so the cutover
itself has zero outstanding exposure by the time it executes.

**Caveat on the numbers above:** these were obtained via direct RPC queries against live
mainnet state; the agent drafting this ADR did not have RPC credentials configured in its
environment and could not independently re-verify them at drafting time. Re-confirm
`RewardVault.totalReserved()` fresh, immediately before executing the cutover below, rather
than relying on this snapshot.

## Considered options

| Option                                                                                                                                                                                                                 | Pros                                                                                                                                                                                                                                   | Cons                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Deploy a fresh `RewardVault` (and fresh `EpochBudget`/hook); leave the old vault/hook/budget fully authorized until every pre-upgrade task settles (originally chosen, now superseded)                                 | Zero risk to any outstanding reservation, however many there turn out to be                                                                                                                                                            | Assumes an unknown/unbounded set of outstanding reservations; on-chain evidence shows there's exactly one, small, identifiable one — this is now more machinery (a second vault, a balance-fragmentation/re-funding step, an indefinite drain-and-monitor window) than the actual risk justifies |
| Reuse the existing `RewardVault` via an immediate breaking `setHook()` cutover, accepting the one identified outstanding reservation as a known casualty, compensated out-of-band (considered, superseded)             | Simple, permanent, single-vault cutover with no waiting                                                                                                                                                                                | One worker's DREAMS bonus (208.2 DREAMS on task `0x8c59...ed8`) would silently fail to pay out on-chain, requiring after-the-fact manual compensation — avoidable at essentially no cost given how small and identifiable this one reservation is                                                |
| Manually settle/refund the one outstanding reservation out-of-band first, confirm `totalReserved() == 0`, then do a breaking `setHook()` cutover on the existing `RewardVault` with zero outstanding exposure (chosen) | Simple, permanent, single-vault cutover; no fresh-vault deployment, no balance migration, no indefinite monitoring window, and zero silent-payout casualties — the one reservation is resolved deliberately instead of broken silently | Requires one manual, one-time operational step (identifying the worker and settling/refunding this specific reservation) before the cutover can proceed; ships slightly later than an immediate cutover would have                                                                               |

## Decision

Before touching the hook, manually settle/refund the one identified outstanding reservation
(task `0x8c59...ed8`, 208.2 DREAMS) out-of-band, so `RewardVault.totalReserved()` reads zero.
Once confirmed at zero, deploy a new `TaskTokenRewardHook` (implementing the `#202` fix) and a
new `EpochBudget` instance, then call `RewardVault.setHook(newHook)` directly on the
**existing, currently deployed** `RewardVault` — no fresh vault is deployed, and no balance
migration is required. Immediately before executing `setHook()`, re-check
`RewardVault.totalReserved()` fresh one more time: if it still reads zero, proceed; if a new
reservation has appeared since, stop and reassess (either settle that one too, or fall back to
this ADR's superseded fresh-vault option) before firing the cutover.

Because the one known reservation is resolved deliberately beforehand rather than left to break
silently, this cutover has zero outstanding exposure at execution time — there is no casualty
to compensate after the fact.

## Consequences

**Positive:**

- No fresh `RewardVault` deployment, no DREAMS balance migration/re-funding step, no
  fragmented custody across two vault addresses, no indefinite "is the old instance drained
  yet" monitoring window.
- Zero silent-payout casualties — the one identified reservation is resolved on purpose before
  the cutover, not lost as a side effect of it.

**Negative / trade-offs:**

- Requires one manual, one-time operational step (identifying the worker behind task
  `0x8c59...ed8` and settling/refunding that reservation) as a precondition before the cutover
  can safely proceed — the cutover is blocked until this is done and confirmed via
  `totalReserved() == 0`.
- Depends on the on-chain research in this ADR's Context section being accurate and current at
  execution time — mitigated by re-checking `totalReserved()` fresh immediately before the
  `setHook()` call rather than trusting the snapshot recorded here.

**Neutral / follow-up:**

- Making `EpochBudget` itself upgradeable (so a _future_ logic-only fix to it, one that doesn't
  change its external interface, could ship via `upgradeTo()` at a stable address with no new
  hook/vault dance at all) was discussed as a separate, larger future investment. It would not
  have changed the scope of shipping this particular fix (which inherently requires
  `TaskTokenRewardHook`'s own bytecode to change too), so it's left out of this ADR and not
  designed here.
- The upgrade script (`packages/contracts/script/SwapRewardHook.s.sol` — deploys the new
  `EpochBudget`/hook pair and calls `RewardVault.setHook()` + `AdminFacet.setDefaultHooks()`) is
  implemented; see the `SKIP_RESERVATION_CHECK` discussion below for its one deliberate deviation
  from this ADR's guarantees.
- `SwapRewardHook.s.sol` (the script implementing this decision) additionally exposes a
  `SKIP_RESERVATION_CHECK` env var / `make swap-reward-hook <net> force` escape hatch that
  bypasses the `totalReserved() == 0` guard entirely, on both testnet and mainnet. This is a
  direct, deliberate deviation from this ADR's "zero silent-payout casualties" framing above —
  using it means any reservation still outstanding on the old hook becomes unrecoverable via
  this script, with no revert, no event, no error anywhere. It exists for testnet ergonomics
  (dust reservations there aren't worth chasing down before every cutover) and defaults off on
  mainnet (`SKIP_RESERVATION_CHECK_MAINNET=false`), but the same flag works on mainnet if
  explicitly forced. Treat "the guard passed" as the only thing this ADR actually vouches for
  as safe; running with the guard skipped on mainnet is an unreviewed exception to this
  decision each time it happens, not a covered case.

## References

- Issue #202 / PR #215 — the `EpochBudget.release()` epoch-mismatch fix this upgrade ships
- `packages/contracts/src/facets/CoreFacet.sol` — `_buildAndCheckHooks` (task-creation-time hook
  pinning), confirming in-flight tasks aren't affected by `defaultHooks` changing
- `packages/contracts/src/hooks/EpochBudget.sol`, `RewardVault.sol` — `onlyHook` gating and
  `setHook()` (single-authorized-hook design)
- `packages/contracts/src/hooks/TaskTokenRewardHook.sol` — `try/catch`-wrapped calls into both
  satellite contracts, confirming a deauthorized old hook fails silently rather than reverting
- Live mainnet `EpochBudget` (`0x2566c90adcce4acfd69f66591022820e92d421d2`) and `RewardVault`
  (`0x351265d55c17ced91f5604b4037171e803bc9c2b`) on-chain state, queried 2026-07-23 — see
  Context section for the specific figures and the verification caveat
- `script/upgrades/Rev012Upgrade.s.sol` — the versioned-upgrade-step precedent for how the
  Diamond side of the surrounding batch (Rev013) is applied, for reference on script structure

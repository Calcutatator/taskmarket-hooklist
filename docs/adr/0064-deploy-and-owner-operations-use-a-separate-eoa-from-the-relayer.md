# 0064 — Deploy and owner operations use a separate EOA from the relayer

> **Decision (Y-statement):** In the context of one EOA currently holding every privileged role
> across the protocol while also serving as the backend's high-throughput relayer, facing a key
> whose routine hot-path use is incompatible with the blast radius of the ownership it carries,
> we decided to migrate contract ownership to a dedicated deployer/owner EOA while leaving the
> relayer's operational roles in place, to achieve a separation where a compromised or
> nonce-contended relayer cannot take the protocol or its DREAMS reserve, accepting a migration
> whose middle section is irreversible and must be completed in one ordered pass.

- **Status:** Proposed
- **Date:** 2026-08-05
- **Embodiment:** Not started
- **Last audited:** `[unaudited]`
- **Author:** Claude Code (drafted for review)
- **Reviewers:** (pending — no reviewer recorded yet)
- **Deciders:** (pending — required before Status may become Accepted)
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** —
- **Pending Amends / Amended-by:** —

## Context

On mainnet, one address — `0x3C0820e2dabD5FEAe1fd03B78079DEe15c7F83D8` — currently holds every
privileged role in the system:

| Role                            | Kind                                          |
| ------------------------------- | --------------------------------------------- |
| Diamond `owner()`               | Custom 2-step transfer/accept in `LibDiamond` |
| RewardVault `owner()`           | OpenZeppelin `Ownable`, 1-step                |
| EpochBudget `owner()`           | OpenZeppelin `Ownable`, 1-step                |
| TaskTokenRewardHook `owner()`   | OpenZeppelin `Ownable`, 1-step                |
| TaskTokenRewardHook `backend()` | Operational role, not ownership                |

The forwarder's `authorizedRelayer()` is the same address and is `immutable` — it cannot be
changed at all without redeploying the forwarder. Diamond `pendingOwner()` is zero, so there is
no half-completed transfer to reason about. RewardVault holds roughly 991,835 DREAMS with
`totalReserved()` at 0.

The same key is also the backend relayer and is configured as `FORGE_DEV_PRIVATE_KEY` for
deploys. That combination has two distinct costs.

The first is blast radius. The relayer key is hot by design: it is loaded in the backend process,
signs continuously, and is the key most exposed to any application-level compromise. Today that
key can also upgrade the Diamond and drain the reward vault. Ownership and hot-path signing want
opposite handling, and one address cannot have both.

The second is operational interference, and it is not hypothetical. Because deploys sign with the
same wallet the backend is allocating nonces for, a `forge script --broadcast` run consumes a
nonce the dispatcher had already issued — the failure ADR-0063 makes the reconciler survive.
ADR-0063 is the right fix for reconciler liveness, but the collision should not be happening at
all.

The migration is constrained by what each contract permits. The Diamond's 2-step transfer is
recoverable: an unaccepted `transferOwnership` can be overwritten or left to expire, so it is
safe to attempt first. The three hook-side contracts are plain non-proxy OpenZeppelin `Ownable` —
1-step, instant, with no pending state and no undo. They also inherit `renounceOwnership()`,
which permanently destroys ownership with no recovery path.

The contracts differ sharply in what a mistake costs. Hook and EpochBudget are replaceable by
redeploy-and-rewire — that is exactly what `swap-reward-hook` does, gated on the Diamond owner —
so losing control of either is recoverable at the cost of a redeploy. RewardVault is not
replaceable: losing its ownership loses the DREAMS it holds.

Two roles must not move. `hook.backend()` is what authorises the backend to credit and pay out
DREAMS; moving it to a cold deployer key breaks withdrawals for every user. The forwarder's
`authorizedRelayer` is immutable and must keep matching the relayer that actually signs.

Finally, `SwapRewardHook.s.sol` uses a single owner key for the vault, the budget, and
`setDefaultHooks`. Ownership split across two addresses breaks that script outright, which makes
a partially-completed migration worse than either end state.

## Considered options

| Option                                                                            | Pros                                                                                                                                                                | Cons                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dedicated deployer/owner EOA; relayer keeps `backend()` and stays the relayer (chosen) | Removes the hot key's authority over upgrades and the vault; ends the deploy/relayer nonce collision at source; a single ordered migration with a defined point of no return | Introduces a second key to hold and protect; the middle of the migration is irreversible; an EOA is still one key, not a quorum                                                                                            |
| Do nothing; rely on ADR-0063 to absorb the collisions (rejected)                    | No migration risk at all                                                                                                                                            | Leaves the blast radius untouched, which is the larger problem. ADR-0063 addresses reconciler liveness, not the fact that a hot key can drain the vault                                                                    |
| Move ownership to a multisig now (rejected for this step)                            | Strictly better custody than any single EOA; the right long-term destination                                                                                        | Every irreversible step in this migration would be taken for the first time against a signer set nobody has exercised. Getting off the relayer key is urgent and independently valuable; a multisig is a follow-on move from a clean owner |
| Move `hook.backend()` to the new key as well (rejected)                              | Superficially tidier — one key for everything hook-related                                                                                                          | Breaks DREAMS withdrawals for every user. `backend()` is an operational role and belongs with the wallet that actually relays                                                                                              |
| Redeploy the affected contracts under the new owner instead of transferring (rejected) | Avoids transfer mechanics entirely                                                                                                                                  | RewardVault cannot be redeployed without moving ~991,835 DREAMS and re-pointing everything at it — strictly more risk than a transfer, for the one contract where a mistake is unrecoverable                                |

## Decision

Contract ownership moves to a dedicated deployer/owner EOA, distinct from the backend relayer.
The Diamond, RewardVault, EpochBudget and TaskTokenRewardHook `owner()` roles transfer to it;
`hook.backend()` and the forwarder's `authorizedRelayer` stay on the relayer wallet. The new key
becomes `FORGE_DEV_PRIVATE_KEY` for deploys, upgrades and owner-gated Makefile targets.

The migration is ordered by reversibility. The Diamond's 2-step transfer goes first and doubles
as the proof-of-control test for the new key: nothing irreversible happens until the new key has
demonstrably signed an `acceptOwnership`. The first hook `transferOwnership` is the point of no
return. RewardVault, the one contract whose loss is unrecoverable, goes last, when the new key
has already been exercised against two cheaper targets. `renounceOwnership` is never called on
anything. Testnet is rehearsed end to end first.

The ordered procedure, with the exact verification commands for each step, is
`docs/RUNBOOK_DEPLOYER_KEY_MIGRATION.md`. This ADR records the decision; it does not authorise
execution, and no step of it has been executed.

## Consequences

**Positive:**

- A compromise of the backend relayer no longer implies control of the Diamond or the reward
  vault. The hot key keeps only the operational roles it needs.
- Deploys and upgrades stop contending for the relayer's nonces, removing the common cause of the
  ADR-0063 failure rather than only surviving it.
- Owner authority sits on a key that can be held cold, which is the precondition for later moving
  it to a multisig.

**Negative / trade-offs:**

- A second key to generate, fund and protect. Losing it costs the protocol its upgrade path and
  its DREAMS reserve, so its custody must be at least as good as the relayer's is today.
- The migration cannot be safely abandoned midway: the hook transfers are irreversible and
  `SwapRewardHook.s.sol` assumes a single owner key across vault, budget and `setDefaultHooks`.
- Owner operations gain a step — the deployer key has to be brought out to run them.

**Neutral / follow-up:**

- `make contract pause|unpause|accept-ownership` now take an explicit `testnet|mainnet` argument,
  so an owner action cannot silently hit whichever chain the ambient environment pointed at. That
  matters more once the owner is a key deliberately used rarely.
- The forwarder's `authorizedRelayer` is immutable; changing the relayer address at any future
  point requires a forwarder redeploy, independent of this decision.
- A multisig owner remains the intended destination and is a separate decision.

## References

- ADR-0063 — the reconciler fix for the nonce collision this removes the cause of.
- `docs/RUNBOOK_DEPLOYER_KEY_MIGRATION.md` — the ordered execution procedure.
- `packages/contracts/src/libraries/LibDiamond.sol` — the 2-step ownership transfer.
- `packages/contracts/script/SwapRewardHook.s.sol` — assumes one owner key.

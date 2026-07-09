# EXT-001: Token Reward Hook

**Status:** Implemented
**Type:** Daydreams Extension (not a TMP protocol standard)

---

## Overview

EXT-001 rewards task contributors with DREAMS protocol tokens on top of their USDC
payment. It is implemented as an opt-in ERC-8195 hook — no core protocol changes are
required, and tasks without the hook are unaffected.

Token amounts are denominated in USD terms and converted to DREAMS at an
admin-settable `dreamsPerUsdc` rate on the hook contract (no on-chain price oracle).
The rate is read once at claim/select-worker time for reserved modes (Claim, Pitch,
Auction); Bounty tasks (no pre-reservation) use the rate at completion. Budget
enforcement prevents runaway token emission through per-epoch global, per-worker, and
per-requester USD caps.

This is a Daydreams-specific extension. It is not part of the ERC-8195 or TMP protocol
standard.

---

## Contracts

| Contract | Role |
|---|---|
| `TaskTokenRewardHook` | `ITMPHook` implementation; orchestrates reservation, payment, and claimable escrow |
| `RewardVault` | Holds pre-funded DREAMS tokens; tracks per-task reserved balances |
| `EpochBudget` | Enforces global, per-worker, and per-requester USD emission caps per epoch |

All three contracts are standalone. They do not modify the Diamond proxy or any
existing storage — the hook is wired in via `setDefaultHooks()` on the Diamond's
AdminFacet.

---

## Reward Formula

`dreamsPerUsdc` is DREAMS wei (18 decimals) per 1 USDC, set by the contract owner via
`setDreamsPerUsdc(uint256)`. There is no on-chain price feed — the owner updates the
rate manually when the market price of DREAMS moves materially (in practice: >20% move
or weekly, whichever comes first).

```
// rewardUsd:    USDC base units (6 decimals). e.g. $100 = 100_000000
// dreamsPerUsdc: DREAMS wei per 1 USDC (18 decimals). e.g. 347 DREAMS/$1 = 347e18

tokenReward = rewardUsd * dreamsPerUsdc / 1e6
```

For Claim / Pitch / Auction tasks, `dreamsPerUsdc` is snapshotted into
`RewardState.startPrice` when the worker is locked in (`checkClaim` /
`checkSelectWorker`), and that same value is used at settlement — the payout is
deterministic once the worker is locked in, with no drift band or re-read needed.

For Bounty tasks (no pre-reservation), the *current* `dreamsPerUsdc` at
`checkComplete` time is used.

**Worked example:** $100 USD task, rate 347 DREAMS/$1:

```
tokenReward = 100_000000 * 347_000000000000000000 / 1_000000 = 34_700 DREAMS
```

---

## hookData

`hookData` is ignored — all configuration lives on the hook contract (rate, caps,
worker split, ramp), set by the owner at deploy time or updated afterward via the
owner-only setters. Tasks opt in by passing the hook's address in `HookConfig`; no
per-task `hookData` payload is needed.

---

## Lifecycle

| Event | Hook call | Action |
|---|---|---|
| `createTask` | `checkFund` | Stores `rewardUsd` from the task's USDC reward. Does not reserve tokens or read a rate yet. |
| `claimTask` / `selectWorker` | `checkClaim` / `checkSelectWorker` | Snapshots the current `dreamsPerUsdc` into `startPrice`. Computes `tokenReward = rewardUsd * startPrice / 1e6`. Consumes `rewardUsd` from `EpochBudget` and reserves `tokenReward` from the vault. If no rate is configured, reserves nothing but does not block the USDC flow. If the vault cannot cover the reservation, the claim/select-worker call reverts. |
| `submitWork` | `checkSubmit` | Validates worker matches the reserved worker (reserved tasks only). |
| `evaluate` | `checkEvaluate` | No-op. |
| `acceptSubmission` / `finalizeVerdict(APPROVE)` / `resolveDispute` | `checkComplete` | Reserved path: pays exactly the reserved amount (deterministic, no drift). Bounty path: prices each winner at the current rate, capped by USD budget and vault balance, then credits tokens. Marks the reward paid. |
| `cancelTask` | `onCancel` | Releases the full reservation (vault tokens + USD budget) to the pools. |
| `refundExpired` | `onExpire` | Same as cancel. |
| `forfeitAndReopen` | `onForfeit` | Same as cancel. |

**Multi-winner (Bounty) path:** `verdict.awards` lists each winner's pre-fee USDC
amount. Each winner's USD basis is capped by `min(workerUsd, epochBudget.remaining(...),
epochBudget.maxUsdPerTask())`, converted to tokens at the current rate, then further
clamped to the vault's available balance (recomputing the USD amount actually consumed
if the vault clamp binds). A shortfall for one winner never blocks payment to the
others or blocks the underlying USDC payout.

---

## Reward State

```solidity
struct RewardState {
    uint256 rewardUsd;            // USDC 6-decimal amount (= task reward)
    uint256 startPrice;           // dreamsPerUsdc snapshot at lock time; 0 for bounty/unreserved
    uint256 reservedTokenAmount;  // tokens reserved from vault (Path A only)
    address requester;
    address worker;
    bool    reserved;             // true for Claim/Pitch/Auction (pre-reserved)
    bool    paid;
}
```

Tokens are credited to a claimable escrow (`claimable[wallet]`) rather than pushed to
wallets directly. A wallet-age ramp (`firstSeen`, `rampThresholds`, `rampMultipliers`)
scales down rewards for wallets younger than the configured thresholds, to limit Sybil
farming. Workers and requesters withdraw their claimable balance via `withdrawFor`,
called by the trusted backend server wallet — see
[DREAMS Token Rewards](/reference/rewards) for the withdrawal flow.

---

## EpochBudget

`EpochBudget` enforces three independent USD emission caps per epoch, all denominated
in USDC base units (6 decimals) — not DREAMS token amounts, so caps stay meaningful as
the DREAMS/USDC rate moves:

| Cap | Setter |
|---|---|
| Global USD per epoch | `setGlobalCapUsd` |
| Per-worker USD per epoch | `setWorkerCapUsd` |
| Per-requester USD per epoch | `setRequesterCapUsd` |
| Max USD per task | `setMaxUsdPerTask` |

`checkAndConsume(requester, worker, usdAmount)` reverts if any cap would be exceeded;
`release(requester, worker, usdAmount)` reverses a previous consumption (cancel/expire/
forfeit, or a settlement paying less than reserved). Epochs are time-based:
`(block.timestamp - epochStart) / epochDuration`, rolled over lazily on the next call.

---

## Security Considerations

**No on-chain price oracle.** The rate is a trusted owner-set value with no automated
staleness or liquidity checks. This is a deliberate simplification at current emission
volumes (~$3-5k/week) — the tradeoff is manual rate-update discipline instead of oracle
manipulation/liveness risk. `setDreamsPerUsdc` rejects a zero rate but has no bounds
check on the magnitude of a change; a fat-fingered rate (e.g. off by 1e18) is not
caught on-chain.

**Locked rate for reserved tasks.** Once a worker claims/is selected, `startPrice` is
fixed — later rate changes cannot affect that task's payout. This protects workers from
a rate cut mid-task and protects the protocol from a rate spike mid-task.

**Reservation blocks vault exhaustion race.** Tokens are reserved at claim/select. If
the vault is exhausted after reservation but before completion, the reserved amount is
still available — it is held exclusively for this task.

**Vault exhaustion at claim reverts.** If the vault cannot cover the full reservation,
`checkClaim` / `checkSelectWorker` reverts (the `vault.reserve()` call is not
try-caught). This is a hard failure, not graceful degradation — workers should not be
able to claim a task they cannot be paid for.

**Budget/vault failures never block USDC.** If `EpochBudget.checkAndConsume` fails at
reserve time, or the vault has zero DREAMS available at bounty settlement, the DREAMS
bonus is silently skipped (or partially paid) but the underlying USDC payout always
proceeds.

**Double-payment prevention.** The `paid` flag on `RewardState` is set atomically at
the start of `checkComplete`, before any external call, so a reentrant token-transfer
callback cannot double-pay.

**Ownership.** `RewardVault`, `EpochBudget`, and `TaskTokenRewardHook` are owned by the
deployer key at deploy time. Transfer ownership to a multisig before directing
production token funding into the vault.

---

## Deployment

### Environment variables

See `DeployRewardHook.s.sol` and `DeployRewardHookTestnet.s.sol` for the authoritative
list — do not rely on this doc for exact names; grep the scripts before deploying.
Summary:

| Variable | Required | Description |
|---|---|---|
| `FORGE_PROTOCOL_TOKEN` | yes | DREAMS token address |
| `FORGE_DIAMOND_ADDRESS` | yes | TaskMarket Diamond proxy |
| `FORGE_DREAMS_PER_USDC` | yes | Whole DREAMS per $1 (e.g. `347`); scaled ×1e18 by the script |
| `FORGE_EPOCH_DURATION` | yes | Seconds per emission epoch (e.g. `604800` = 1 week) |
| `FORGE_GLOBAL_EPOCH_CAP_USD` | yes | Max USD-value emitted per epoch (USDC base units) |
| `FORGE_WORKER_CAP_USD` | yes | Per-worker per-epoch cap (USDC base units) |
| `FORGE_REQUESTER_CAP_USD` | yes | Per-requester per-epoch cap (USDC base units) |
| `FORGE_MAX_USD_PER_TASK` | yes | Per-task emission cap (USDC base units) |
| `FORGE_WORKER_SPLIT_BPS` | no | Worker share in bps (default 8000 = 80%) |
| `FORGE_BACKEND_ADDRESS` | yes | Backend server wallet (trusted for `withdrawFor`) |
| `FORGE_INITIAL_VAULT_BALANCE` | no | Tokens to seed the vault with at deploy (wei) |

### Deploy

```bash
make deploy-reward-hook testnet   # mocks a DREAMS token, uses DeployRewardHookTestnet.s.sol
make deploy-reward-hook mainnet   # uses the real DREAMS token, DeployRewardHook.s.sol
```

Both scripts wire the hook into `vault.setHook` / `budget.setHook` and call
`setDefaultHooks([hook])` on the Diamond, replacing the prior default-hook list.

After deploy, transfer `RewardVault` and `EpochBudget` ownership to a multisig, then
fund the vault with DREAMS tokens before directing live task traffic to the hook.

### Post-deploy

1. Transfer `RewardVault` ownership: `vault.transferOwnership(multisig)`
2. Transfer `EpochBudget` ownership: `budget.transferOwnership(multisig)`
3. Transfer `TaskTokenRewardHook` ownership: `hook.transferOwnership(multisig)`
4. Fund vault: `dreamsToken.transfer(vaultAddress, initialFunding)` (or via
   `FORGE_INITIAL_VAULT_BALANCE` at deploy time)
5. Set `DREAMS_HOOK_ADDRESS` in the backend environment — this is the sole switch that
   enables `wallet.dreamsBalance`, `wallet.withdrawDreams`, `wallet.exchangeRate`, and
   the `estimatedDreamsBonus`/`dreamsPerUsdc` fields on `task.get`.

---

## Integration

Tasks opt into token rewards by passing the hook's address in `HookConfig` at
creation — no `hookData` payload is needed (see [hookData](#hookdata) above).

The backend reads the hook's `dreamsPerUsdc()` and `workerSplitBps()` directly
(`apps/backend/src/services/contract.ts`) and surfaces them via
`wallet.exchangeRate` and on `task.get` when the hook is attached to a task. The web
task detail page and publish wizard show the estimated DREAMS bonus using the same
rate — see [DREAMS Token Rewards](/reference/rewards) for the full withdrawal and
transparency surface.

---

## Implementation

Contracts: `packages/contracts/src/hooks/`
Tests: `packages/contracts/test/TaskTokenRewardHook.t.sol`, `EpochBudget.t.sol`
Deploy scripts: `packages/contracts/script/DeployRewardHook.s.sol`,
`DeployRewardHookTestnet.s.sol`
Backend service: `apps/backend/src/services/contract.ts` (`contractGetDreamsPerUsdc`,
`contractGetDreamsWorkerSplitBps`, `contractGetDreamsClaimable`,
`contractWithdrawDreamsRewards`)
Backend router: `apps/backend/src/routers/wallet.router.ts`
Frontend: `apps/web/components/market/dreams-rewards-card.tsx`,
`apps/web/components/market/wizard/step-publish.tsx`,
`apps/web/components/market/tasks.tsx` (task detail caption)
CLI: `apps/cli/src/commands/stats.ts`, `apps/cli/src/commands/wallet/withdraw-dreams.ts`
Smoke test: `apps/backend/scripts/smoke-token-reward-hook.ts`

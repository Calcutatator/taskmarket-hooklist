# ERC-8195 Revision 010 — Multi-Hook and Protocol Default Hooks

## Motivation

Rev003 introduced a single `hookContract` field on each task, written once at `createTask` and
stored immutably. At protocol scale this design has two limitations. First, a requester who wants
multiple independent hook behaviors — token rewards and an analytics hook, for example — cannot
attach both; they must either deploy a wrapper contract that delegates internally or choose one.
Second, the protocol operator has no mechanism to guarantee that a hook fires on every task. A
requester who calls `createTask` directly with `hookContract = address(0)` silently opts out of
any protocol-level hook logic. There is no on-chain enforcement that, for example, every task
triggers the token reward system.

This revision replaces the single `hookContract` field with an ordered hook list per task and adds
a protocol-level `defaultHooks` array that is prepended to every new task's hook list at creation
time. Requesters may append additional hooks; they may not remove default hooks. The existing
single-hook fallback path is preserved for pre-Rev010 tasks so no migration is required.

---

## Problem 1 — One hook slot prevents composition

The `Task` struct held one `address hookContract`. Two independent hook authors could not both
attach to the same task without deploying a bespoke wrapper:

```solidity
// Before (Rev003): one hook slot per task
struct Task {
    // ...
    address hookContract;
}
```

No standard composition mechanism existed. Hook authors had no guarantee their hook would fire
alongside others.

## Problem 2 — Protocol cannot enforce hooks on all tasks

`createTask` accepted `address hookContract` from the caller. Any value, including `address(0)`,
was stored without validation. The protocol operator could not ensure that every task triggered
protocol-level hook behavior:

```solidity
// Before: caller supplies hook address; zero is silently accepted
function createTask(
    uint256 reward,
    uint256 duration,
    // ...
    address hookContract,
    // ...
) external returns (bytes32 taskId);
```

Tasks created via raw contract calls (bypassing the frontend) would have no hook attached,
silently opting out of all protocol-level hook behavior.

---

## Changes

### 1. `LibAppStorage.AppStorage` — two new fields (append-only)

```solidity
// After: appended at end of AppStorage struct (after Rev008 submission-integrity fields)
address[] defaultHooks;
mapping(bytes32 => address[]) taskHooks;
```

`defaultHooks` is the protocol-operator-controlled list prepended to every new task. `taskHooks`
stores the per-task snapshot written once at `createTask` and never modified thereafter.

The existing `Task.hookContract` field is deprecated but not removed. The dispatch path checks
`taskHooks[taskId].length > 0` first; if empty and `task.hookContract != address(0)` it falls
back to the legacy single-hook path. This ensures all pre-Rev010 tasks continue to work without
migration.

### 2. `CoreFacet.createTask` — `HookConfig` struct replaces `address hookContract`

```solidity
// Before (Rev003): single address parameter
function createTask(
    uint256 reward,
    uint256 duration,
    bytes4 mode,
    uint256 pitchDeadline,
    uint256 bidDeadline,
    bytes4 auctionSubtype,
    address hookContract,
    bytes32[] calldata tags,
    bytes calldata hookData
) external returns (bytes32 taskId);

// After (Rev010): packed struct to reduce calldata slot pressure
struct HookConfig {
    address[] contracts;
    bytes data;
}

function createTask(
    uint256 reward,
    uint256 duration,
    bytes4 mode,
    uint256 pitchDeadline,
    uint256 bidDeadline,
    bytes4 auctionSubtype,
    ITMPCore.HookConfig calldata hookConfig,
    ITMPCore.TaskContent calldata content
) external returns (bytes32 taskId);
```

At creation the Diamond builds the task's hook list as `defaultHooks ++ hookConfig.contracts`.
Each address in the combined list must implement `ITMPHook` (verified via
`IERC165.supportsInterface`). A zero address in either list reverts. Duplicate addresses are
permitted — each hook fires independently.

`hookConfig.data` is forwarded to every hook's `checkFund` call unchanged. Hooks that require
per-task configuration encode discriminators in `hookData` and ignore bytes not addressed to them.

### 3. `AdminFacet` — default hook management

```solidity
// New functions added to AdminFacet

/// Replace the protocol default hook list. Emits DefaultHooksSet(hooks).
/// Only callable by the Diamond owner.
function setDefaultHooks(address[] calldata hooks) external;

/// Read the current default hook list.
function getDefaultHooks() external view returns (address[] memory);
```

`setDefaultHooks` replaces the list atomically. It does not affect tasks already created —
`taskHooks[taskId]` is snapshot at creation and immutable thereafter. This protects requesters
and workers from post-funding hook changes.

### 4. `LibTaskMarket` — multi-hook dispatch helpers

```solidity
// Before (Rev003): single-hook dispatch
function _afterHook(address hook, bytes memory data) internal { ... }
function _checkHook(address hook, bytes memory data) internal { ... }

// After (Rev010): dispatch to ordered list
function _resolveHooks(bytes32 taskId, AppStorage storage s)
    internal view returns (address[] memory);
function _dispatchAfterHooks(address[] memory hooks, bytes memory data) internal;
function _dispatchCheckHooks(
    address[] memory hooks,
    bytes memory data,
    bytes4 revertSelector
) internal;
```

`_resolveHooks` returns `taskHooks[taskId]` when populated, falling back to a single-element
array wrapping `task.hookContract` for pre-Rev010 tasks. `_dispatchAfterHooks` wraps each call
in try-catch so a failing `on*` hook cannot block state transitions. `_dispatchCheckHooks`
propagates reverts from `check*` hooks — a check failure reverts the entire transition.

### 5. Dispatch semantics — unanimous gate vs. fire-and-forget

All hooks in `taskHooks[taskId]` are called in list order.

`check*` hooks (unanimous gate): if any hook returns `false` or reverts, the transition reverts
with `HookCheckCompleteRejected` (or the mode-appropriate selector). All hooks see the same
pre-committed state.

`on*` hooks (fire-and-forget): each call is wrapped in try-catch. A failure in hook N does not
prevent hooks N+1..end from firing. No hook failure can revert the transition.

### 6. `RegistryFacet` — `getTaskHooks` getter

```solidity
// New getter
function getTaskHooks(bytes32 taskId) external view returns (address[] memory);
```

Returns the effective hook list for a task using the same `_resolveHooks` resolution logic as
dispatch. Callers can determine which hooks will fire for a given task before submitting.

---

## Rationale

**Why not per-hook `hookData`?** A single `bytes hookData` blob is forwarded to all hooks. Hooks
that need per-task configuration use constructor-level parameters for fixed config, or encode
discriminated data in `hookData` and skip bytes not addressed to them. A future revision may
introduce `bytes[] hookDataPerHook` if per-hook data proves necessary in practice. Keeping a
single blob avoids a `bytes[]` calldata parameter that would add stack pressure in `createTask`.

**Why snapshot at creation, not at dispatch?** `taskHooks[taskId]` is written once and never
modified. A task's hook behavior is fully determined at funding time. The protocol operator cannot
add or remove hooks from a task after it is funded. This protects requesters and workers from
bait-and-switch upgrades.

**Why prepend default hooks rather than append?** Protocol hooks fire before requester hooks.
This ensures protocol-level `check*` gates cannot be short-circuited by a requester hook that
returns `true` early. For `on*` hooks order is less significant but consistency is maintained.

**Why not deduplicate hooks in the list?** Deduplication adds gas to every `createTask` call to
protect against an unlikely configuration. Hook authors should be idempotent or use task-level
state (as `TaskTokenRewardHook` does with `taskReserve`) to guard against double-execution.
Duplicates are intentional for some configurations, for example two reward vaults of the same
type.

**Why not a mapping from `taskId` to a hook-set fingerprint?** Storing the ordered list directly
in `taskHooks` is simpler and allows callers to enumerate hooks without a separate registry
lookup.

---

## API Changes

- `createTask` signature: `address hookContract` + `bytes32[] tags` + `bytes hookData` replaced
  by `ITMPCore.HookConfig hookConfig` + `ITMPCore.TaskContent content` (two packed structs to
  reduce calldata slot pressure).
- `AdminFacet` gains `setDefaultHooks(address[])` and `getDefaultHooks()`.
- `RegistryFacet` gains `getTaskHooks(bytes32)`.
- `ITMPCore.HookConfig` and `ITMPCore.TaskContent` structs added to the interface.
- `ITMPCore.HookCheckCompleteRejected` error added.
- New hook contracts: `TaskTokenRewardHook`, `RewardVault`, `EpochBudget`
  (see `src/hooks/`). DREAMS/USDC pricing is an admin-settable `dreamsPerUsdc`
  rate on the hook — no on-chain price oracle.
- `TaskTokenRewardHook` uses a claimable escrow model — tokens are held inside
  the hook rather than pushed to worker wallets. Workers withdraw via
  `withdrawFor(wallet, destination)` called by the trusted backend server wallet.
- Wallet-age Sybil ramp: `firstSeen[wallet]` is set on first hook interaction;
  reward multiplier scales 0% → 25% → 50% → 100% over configurable thresholds
  (default 2 / 4 / 8 weeks). Thresholds and multipliers are configurable via
  `setRamp()` by the owner.
- Worker/requester split: `workerSplitBps` (default 8000 = 80% worker, 20%
  requester) is configurable via `setWorkerSplitBps()`.
- `EpochBudget` caps (`globalCapUsd`, `workerCapUsd`, `requesterCapUsd`,
  `maxUsdPerTask`) are denominated in USDC base units, not DREAMS token
  amounts, so they stay meaningful as the DREAMS/USDC rate moves.
- Admin functions: `banWallet`, `unbanWallet`, `setBackend`, `sweepUnclaimed`,
  `setDreamsPerUsdc`.
- Deploy script: `script/DeployRewardHook.s.sol` — `make deploy-reward-hook testnet/mainnet`.
- New backend procedures: `wallet.dreamsBalance` (GET), `wallet.withdrawDreams`
  (POST), `wallet.exchangeRate` (GET). `task.get` returns `dreamsPerUsdc` and
  `estimatedDreamsBonus` when the reward hook is attached to the task.
- New CLI command: `taskmarket wallet withdraw-dreams [--destination <addr>]`.
  `taskmarket stats` shows `pendingDreamsRewards`, `pendingDreamsUsd`, and
  `dreamsPerUsdc`.

---

## Affected Files

| File | Change |
|------|--------|
| `packages/contracts/src/libraries/LibAppStorage.sol` | Append `defaultHooks` and `taskHooks` fields to `AppStorage` |
| `packages/contracts/src/libraries/LibTaskMarket.sol` | Add `_resolveHooks`, `_dispatchAfterHooks`, `_dispatchCheckHooks`, `_onCompleteHooks`, `_onCancelHooks`, `_onExpireHooks`, `_onForfeitHooks` |
| `packages/contracts/src/facets/CoreFacet.sol` | Replace `address hookContract` with `HookConfig`; call `_buildAndCheckHooks` at task creation |
| `packages/contracts/src/facets/AcceptanceFacet.sol` | Replace single-hook dispatch with `_resolveHooks` + `_dispatchCheckHooks` / `_dispatchAfterHooks` |
| `packages/contracts/src/facets/AuctionFacet.sol` | Replace single-hook dispatch with multi-hook helpers |
| `packages/contracts/src/facets/EvaluatorFacet.sol` | Replace single-hook dispatch with multi-hook helpers |
| `packages/contracts/src/facets/AdminFacet.sol` | Add `setDefaultHooks`, `getDefaultHooks` |
| `packages/contracts/src/facets/RegistryFacet.sol` | Add `getTaskHooks` getter |
| `packages/contracts/src/interfaces/ITMPCore.sol` | Add `HookConfig`, `TaskContent` structs; add `HookCheckCompleteRejected` error |
| `packages/contracts/src/hooks/TaskTokenRewardHook.sol` | New: USD-denominated DREAMS token reward hook implementing `ITMPHook`; admin-settable `dreamsPerUsdc` rate, no on-chain oracle |
| `packages/contracts/src/hooks/RewardVault.sol` | New: holds DREAMS tokens; only the hook can reserve/release/pay |
| `packages/contracts/src/hooks/EpochBudget.sol` | New: per-epoch USD emission caps (USDC base units) with epoch-indexed rollover |
| `packages/contracts/src/interfaces/IRewardVault.sol` | New: vault interface used by the reward hook |
| `packages/contracts/script/DeployRewardHook.s.sol` | New: deploy script for hook + vault + budget |
| `packages/contracts/test/TaskTokenRewardHook.t.sol` | New: reward hook test suite |
| `packages/contracts/test/EpochBudget.t.sol` | New: epoch budget unit tests |
| `packages/contracts/test/RewardVault.t.sol` | New: vault unit tests |
| `packages/contracts/test/TaskMarket.t.sol` | Update all `createTask` and acceptance calls to new signatures |
| `packages/contracts/test/TaskMarketForwarder.t.sol` | Update `createTask` calls to new signatures |
| `packages/contracts/test/ITMP.t.sol` | Update interface compliance tests |
| `packages/contracts/test/helpers/DiamondTestHelper.sol` | Add `setDefaultHooks` helper |
| `packages/contracts/test/helpers/ITaskMarketFull.sol` | Add `setDefaultHooks`, `getDefaultHooks`, `getTaskHooks` to interface |

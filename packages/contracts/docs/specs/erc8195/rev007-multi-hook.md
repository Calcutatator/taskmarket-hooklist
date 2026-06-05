# ERC-8195 Revision 007 — Multi-Hook and Protocol Default Hooks

## Motivation

Rev003 introduced a single `hookContract` per task, written once at `createTask()` and stored
immutably in the task struct. This design has two limitations that become apparent at protocol
scale:

**Composability.** A requester who wants both a token-reward hook and an analytics hook cannot
attach both. They must either deploy a wrapper contract that delegates to two hooks (fragile,
bespoke) or choose one. Independent hook authors cannot compose their work without coordination.

**Protocol-level enforcement.** The protocol operator cannot guarantee that a hook fires on every
task. A requester who calls `createTask` directly (bypassing the official CLI or frontend) with
`hookContract = address(0)` silently opts out. There is no on-chain mechanism to ensure, for
example, that every task triggers the token reward system.

Rev007 replaces the single `hookContract` field with an ordered hook list per task, and adds a
protocol-level `defaultHooks` array that is prepended to every new task's hook list at creation
time. Requesters may append additional hooks; they may not remove default hooks.

---

## Storage Changes

Two new fields are appended to `AppStorage` (append-only; existing slot layout is unchanged):

```solidity
/// Hooks prepended to every new task's hook list by the protocol operator.
address[] defaultHooks;

/// Per-task ordered hook list, populated at createTask().
/// Replaces task.hookContract for all tasks created after this revision.
mapping(bytes32 => address[]) taskHooks;
```

The existing `address hookContract` field in the `Task` struct is **deprecated** but not removed.
For tasks created before this revision it remains the authoritative hook address. For tasks created
after this revision `hookContract` is set to `address(0)` and `taskHooks[taskId]` is used instead.
Dispatch logic checks `taskHooks[taskId].length > 0` first; if empty and `task.hookContract != address(0)`
it falls back to the legacy single-hook path. This ensures all existing tasks continue to work
without migration.

---

## Interface Changes

### createTask

The `hookContract` parameter is replaced by `address[] calldata hookContracts`:

```solidity
function createTask(
    uint256 reward,
    uint256 duration,
    ITMPCore.TaskMode mode,
    uint256 pitchDeadline,
    uint256 bidDeadline,
    bytes32 contentHash,
    string  calldata contentURI,
    ITMPCore.AuctionSubtype auctionSubtype,
    address[] calldata hookContracts,   // replaces address hookContract
    bytes32[] calldata tags,
    bytes    calldata hookData
) external returns (bytes32 taskId);
```

At creation the Diamond builds the task's hook list as:

```
taskHooks[taskId] = defaultHooks ++ hookContracts
```

Each address in the combined list MUST implement `ITMPHook` (verified via `IERC165.supportsInterface`).
A zero address in either list MUST revert. Duplicate addresses are permitted — each hook fires
independently regardless of whether another instance of the same contract is also in the list.

`hookData` is forwarded to every hook's `checkFund` call unchanged. Hooks that require
per-hook configuration SHOULD encode discriminators in `hookData` and ignore bytes not intended
for them, or use per-hook constructor configuration.

### AdminFacet — default hook management

```solidity
/// Replace the protocol default hook list.
/// Emits DefaultHooksSet(hooks).
/// Only callable by the Diamond owner.
function setDefaultHooks(address[] calldata hooks) external;

/// Read the current default hook list.
function getDefaultHooks() external view returns (address[] memory);
```

`setDefaultHooks` replaces the list atomically. It does not affect tasks already created —
`taskHooks[taskId]` is snapshot at creation and immutable thereafter.

---

## Dispatch Semantics

### check* hooks — unanimous gate

All hooks in `taskHooks[taskId]` are called in order. If any hook returns `false` or reverts,
the entire transition reverts. Hooks are called in list order; earlier hooks see the same
committed state as later hooks.

```
for hook in taskHooks[taskId]:
    if !hook.checkXxx(...): revert HookRejected(taskId, hook)
```

### on* hooks — independent fire-and-forget

All hooks are called in order. Each call is wrapped in its own try-catch. A failure in hook N
does not prevent hooks N+1..end from being called. No hook failure can revert the transition.

```
for hook in taskHooks[taskId]:
    try hook.onXxx(...) {} catch {}
```

This matches the existing single-hook semantics extended to N hooks.

### Legacy fallback

If `taskHooks[taskId].length == 0` and `task.hookContract != address(0)`, dispatch falls back
to calling `task.hookContract` alone. This path is read-only from the perspective of new code
and will be removed in a future revision once all legacy tasks have expired.

---

## getTask / TaskContext

`ITMPRegistry.getTask` adds a `hooks` field to the returned struct:

```solidity
struct Task {
    // ... existing fields unchanged ...
    address   hookContract;  // deprecated; zero for post-rev007 tasks
    address[] hooks;         // populated from taskHooks[taskId]; empty for pre-rev007 tasks
}
```

Callers SHOULD use `hooks` and treat `hookContract` as a fallback for pre-rev007 tasks.

---

## Backward Compatibility

| Scenario | Behaviour |
|----------|-----------|
| Pre-rev007 task, hookContract set | Legacy path fires; `taskHooks` empty |
| Pre-rev007 task, hookContract zero | No hook fires (unchanged) |
| Post-rev007 task, no requester hooks | Only `defaultHooks` fire |
| Post-rev007 task, requester hooks | `defaultHooks ++ requesterHooks` fire |
| Post-rev007 task, defaultHooks empty, no requester hooks | No hook fires |

Existing hook implementations (`ITMPHook`) require no changes. The interface is identical; only
the dispatch caller changes.

---

## Rationale

**Snapshot at creation, not at dispatch.** `taskHooks[taskId]` is written once and never
modified. This means a task's hook behaviour is fully determined at creation time. The protocol
operator cannot add or remove hooks from a task after it is funded. This protects requesters and
workers from bait-and-switch upgrades.

**defaultHooks are prepended, not appended.** Protocol hooks fire before requester hooks.
This ensures protocol-level check* gates (e.g. a compliance hook that rejects sanctioned
addresses) cannot be short-circuited by a requester hook that returns true early. For on*
hooks order is less significant but consistency is maintained.

**No per-hook hookData.** A single `hookData` bytes blob is forwarded to all hooks. Hooks
that need per-task configuration SHOULD use constructor-level parameters for fixed config, or
encode discriminated data in `hookData` and skip bytes not addressed to them. A future revision
may introduce `bytes[] hookDataPerHook` if per-hook data proves necessary in practice.

**Duplicates permitted.** Two instances of the same hook contract in the list fire twice. This
is an unlikely but valid configuration (e.g. two reward vaults of the same type). The protocol
does not deduplicate; hook authors SHOULD be idempotent or use task-level paid flags (as
`TaskTokenRewardHook` does) to guard against double-execution.

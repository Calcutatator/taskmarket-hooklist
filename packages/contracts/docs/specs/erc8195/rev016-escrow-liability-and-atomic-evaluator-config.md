# ERC-8195 Revision 016 — Settled Escrow Liability and Atomic Evaluator Configuration

## Motivation

Three defects are fixed here, and they share a shape: in each one, a durable fact and the thing
it was supposed to govern were written at different moments, and the gap between those moments
was exploitable.

Two of them are about money. Escrow in this contract is a single pooled USDC balance — there is
no per-task sub-account — so the only record of what the pool owes is the set of `task.reward`
values in `AppStorage`. `refundExpired` paid a task's reward out without ever zeroing that
record, and did not treat `Expired` (the status it sets itself) as terminal, so a second call
passed every guard and paid the same reward again out of other tasks' escrow. `updateTask` was
the mirror image: the forwarder pulls a reward increase from the requester *before* the Diamond
executes, and the Diamond has no path to hand it back, so a repeated relay of the same increase
hit a now-false `newReward != task.reward` guard, no-op'd, and kept the money. The first was
confirmed exploitable on mainnet with a passing Forge proof of concept before the fix landed.

The third is about time rather than money, but it is the same failure of atomicity. `createTask`
took no evaluator configuration, so a task with an evaluator needed a second transaction,
`assignEvaluator`. That call is gated on the task still being `Open`, and the task is claimable
the instant `createTask` mines — so the second call raced every worker agent watching for new
tasks, and could lose permanently. It did: ADR-0047 records a sandbox run in which 4 of 4
assignments were unreachable, each stuck on `TaskNotOpen`, retried on a timer for ever, with no
alert anywhere because nothing ever reached a terminal state.

This revision writes each settled fact together with what it settles: the reward is zeroed by the
statement group that pays it out, a payment that will not produce a change reverts rather than
being absorbed, and evaluator terms are applied by the transaction that creates the task.

---

## Problem 1 — `refundExpired` is repeatable and drains other tasks' escrow (#432)

`CoreFacet.refundExpired` rejected `Accepted` and `Cancelled`, but not `Expired` — the status its
own refund path assigns. No refund path zeroed `task.reward`. Escrow is pooled. Those three facts
compose into a repeatable full payout:

```solidity
// before
if (task.status == ITMPCore.TaskStatus.Accepted) revert ITMPCore.TaskAlreadyAccepted();
if (task.status == ITMPCore.TaskStatus.Cancelled) revert ITMPCore.TaskIsCancelled();
// ... no Expired guard, and _refundExpiredNormal never touches task.reward
```

The call is permissionless by design (ADR-0026), so any address could drive it. The attacker
gains nothing directly — the money still goes to that task's requester — but every repeat is
funded from the pooled balance, so unrelated, fully funded tasks become unable to pay out. The
auction branch was reachable identically: `_refundAuctionClaimed`'s claimed-but-never-delivered
path also sets `Expired` and also left the reward standing.

Issue #198 had already fixed the neighbouring bug in this same function and passed directly over
this one; see the Rationale.

## Problem 2 — `updateTask` absorbs a duplicate reward-increase payment

`updateTask` guarded a reward change on `newReward != task.reward`. When a relayed call is
retried, the guard is false the second time and the function silently no-ops — but the forwarder
has already pulled `newReward - currentReward` from the requester for that attempt, and the
Diamond has no path to return it.

The forwarder's replay guard does not help. It keys on a caller-supplied receipt nonce, so it
stops a byte-identical resubmission but not a retry, and the backend's relayed-intent machinery
retries with a fresh nonce by design. The requester is charged twice for one increase, and the
second payment lands in the pool corresponding to no liability at all.

## Problem 3 — `createTask` takes no evaluator configuration, so assignment races a claim

`createTask` took reward, duration, mode, pitch and bid deadlines, auction subtype, stake config,
hook config and content — and no evaluator configuration of any kind. Configuring an evaluator
therefore required `EvaluatorFacet.assignEvaluator`, a second transaction, gated:

```solidity
if (task.status != ITMPCore.TaskStatus.Open) revert ITMPCore.TaskNotOpen();
```

That gate is correct and is not changed here. Appointing an evaluator to a task a worker has
already claimed changes the terms the worker committed to — who judges the work, on what fee, on
what windows, with which dispute resolver — and the contract is right to refuse.

The defect is that the API accepted evaluator fields at creation while the contract did not, so
the backend had to make two transactions for one product action, with an unavoidable window
between them in which a worker could claim. Worker agents claim in milliseconds. No off-chain
arrangement closes that window; ADR-0046 built a whole intent-chaining subsystem trying to, and
ADR-0047 withdrew it, naming this contract gap as the root cause and deferring the fix to its own
revision. This is that revision.

---

## Changes

### 1. `CoreFacet.refundExpired` — `Expired` is terminal (#432)

```solidity
// before
if (task.status == ITMPCore.TaskStatus.Cancelled) revert ITMPCore.TaskIsCancelled();

// after
if (task.status == ITMPCore.TaskStatus.Cancelled) revert ITMPCore.TaskIsCancelled();
if (task.status == ITMPCore.TaskStatus.Expired) revert ITMPCore.TaskAlreadyRefunded();
```

### 2. `CoreFacet._refundExpiredNormal` and `_refundAuctionClaimed` — zero the reward before paying

Both refund paths now extinguish the recorded liability in the same statement group that decides
to pay it out, before any transfer (checks-effects-interactions). The amount is captured into a
local first, so zeroing does not change what is paid.

```solidity
// before
task.status = ITMPCore.TaskStatus.Expired;
uint256 refundAmount = task.reward - evalFeeAlreadyPaid;

// after
task.status = ITMPCore.TaskStatus.Expired;
uint256 refundAmount = task.reward - evalFeeAlreadyPaid;
task.reward = 0;
```

The same two lines are added to `_refundAuctionClaimed`'s no-deliverable branch, where
`refundAmount` is the full `task.reward`.

### 3. `CoreFacet.updateTask` — revert instead of no-op'ing a named-but-unchanged reward

```solidity
// before
uint256 refund = 0;
if (newReward != 0 && newReward != task.reward) {

// after
if (newReward != 0 && newReward == task.reward) revert ITMPCore.NoRewardChange();

uint256 refund = 0;
if (newReward != 0 && newReward != task.reward) {
```

Callers leave a field unchanged by passing `0`, so this rejects nothing legitimate.

### 4. `CoreFacet.createTask` — take evaluator configuration and apply it atomically

```solidity
// before
function createTask(
    uint256 reward,
    uint256 duration,
    bytes4 mode,
    uint256 pitchDeadline,
    uint256 bidDeadline,
    bytes4 auctionSubtype,
    ITMPCore.StakeConfig calldata stakeConfig,
    ITMPCore.HookConfig calldata hookConfig,
    ITMPCore.TaskContent calldata content
) external returns (bytes32 taskId);

// after
function createTask(
    uint256 reward,
    uint256 duration,
    bytes4 mode,
    uint256 pitchDeadline,
    uint256 bidDeadline,
    bytes4 auctionSubtype,
    ITMPCore.StakeConfig calldata stakeConfig,
    ITMPCore.HookConfig calldata hookConfig,
    ITMPCore.TaskContent calldata content,
    ITMPCore.TaskEvaluatorConfig calldata evaluatorConfig
) external returns (bytes32 taskId);
```

The existing `ITMPCore.TaskEvaluatorConfig` struct is reused rather than a new one introduced,
and the existing `s.taskEvaluatorConfigs[taskId]` mapping already holds the result, so **no
`AppStorage` field is added or changed by this revision**.

Applied inside the function body, before the hook dispatch so a `checkFund` hook observes a fully
configured task:

```solidity
// after
_applyCreationEvaluatorConfig(taskId, requester, evaluatorConfig, s);

_buildAndCheckHooks(taskId, hookConfig, s);
```

A zero `evaluator` means "no evaluator". Terms supplied with a zero evaluator revert
`InvalidEvaluator` rather than being silently discarded.

### 5. `LibTaskMarket._applyEvaluatorConfig` — one shared body for both entry points

The validation, the storage writes, the stake pull and the `EvaluatorAssigned` event moved out of
`EvaluatorFacet.assignEvaluator` into a shared internal helper, which `CoreFacet.createTask` now
also calls. `assignEvaluator` keeps only the two checks that are specific to its own context:

```solidity
// after — EvaluatorFacet.assignEvaluator, in full
if (requester != task.requester) revert ITMPCore.NotRequester();
if (task.status != ITMPCore.TaskStatus.Open) revert ITMPCore.TaskNotOpen();

LibTaskMarket._applyEvaluatorConfig(
    taskId,
    requester,
    ITMPCore.TaskEvaluatorConfig({ ... }),
    s
);
```

`NotRequester` and `TaskNotOpen` have nothing to test on the creation path: the requester is the
authenticated sender by construction, and the task is `Open` by construction. Everything else —
`InvalidEvaluator`, `EvaluatorAlreadyAssigned`, `FeeBpsTooHigh`, the `StakeTransferFailed` pull
from the requester, and the `EvaluatorAssigned` event — is now literally the same code on both
paths rather than two copies that agree today.

### 6. `script/upgrades/Rev016Upgrade.s.sol` — diamond-cut upgrade step

`createTask`'s selector changed (`0xa595d889` → `0x95d5ec3f`), so CoreFacet is a
Remove(old) + Replace(20 unchanged) + Add(new), as rev014 was for the same reason. EvaluatorFacet
changed bytecode with no selector change, so it is a pure Replace of
`FacetSelectors.evalFacetSelectors()`. Precondition `diamondVersion == 15`; sets it to 16.

---

## Rationale

**Why zero the liability instead of just adding the missing status check (#432)?**

The status check alone is a fix for one path; it leaves the invariant unstated and unenforced
anywhere. The history is the argument. Issue #198 fixed the neighbouring bug in this exact
function — `refundExpired` refunding an evaluator fee that `evaluate()` had already paid out —
and #198's own suggested remedy was to reduce `task.reward`, which would have closed #432 as a
side effect. The implemented fix instead deducted `evalFeeAlreadyPaid` at read time and left the
reward liability standing. The bug was found once, the correct remedy was written down once, and
the cheaper local fix was taken, so the same defect was still there for #432 to find in the same
function. Doing it at the liability level means a future status that reaches this path cannot
double-pay even if its guard is wrong, which is the difference between a fix and an invariant.

**Why not track a `totalOutstandingLiability` in `AppStorage` instead?**

It would make the invariant checkable in one place, but it is an `AppStorage` addition on a live
diamond, it has to be maintained correctly at every payout site — including the `Accepted`-
terminating paths this revision deliberately leaves alone — and a maintenance bug in it is a new
way to brick payouts. Zeroing per task needs no new state and is locally verifiable.

**Why make `updateTask` revert rather than genuinely no-op and transfer nothing?**

Not implementable on this side of the forwarder boundary. The forwarder pulls the USDC before the
Diamond executes and the Diamond never learns the amount. Reverting is the only mechanism
available that unwinds the transfer, because the whole transaction unwinds with it.

**Why change `createTask`'s signature rather than add a separate `createTaskWithEvaluator`?**

An additive function was the shape ADR-0047 flagged as possibly right, on the grounds that
`createTask` is part of the `ITMPCore` spec surface and changing it may break other implementors.
It was rejected on reflection for two reasons. First, the two functions would differ in one
parameter and share everything else, so the body has to be shared anyway, and the only durable
result is two selectors, two upgrade paths and two things to keep in step. Second, and more
importantly, leaving the evaluator-less `createTask` in place preserves the exact affordance that
caused the defect: a caller who wants an evaluator can still take the shape that requires a second
transaction, and nothing tells them it races. A spec surface is worth protecting; a spec surface
that makes the wrong call the easy one is not.

**Why remove the old selector rather than route both?**

Routing both is the migration-friendly option and was rejected deliberately. A caller still
encoding the 9-parameter signature is a caller that believes evaluator terms cannot be set at
creation. Accepting that call would create precisely the un-evaluated task this revision exists to
prevent, and would create it *as a success*, with no error for anyone to see, indefinitely. A
removed selector reverts at the diamond's fallback instead — immediate, loud, and correct.
Migration cost is genuinely low: the only in-repo encoder is the backend's hand-written viem ABI
in `apps/backend/src/services/contract.ts`, updated in the same change, and `TaskMarketForwarder`
does not encode the selector itself — it relays whatever calldata it is handed and hashes the
selector into its receipt, so it needs no redeployment.

**Why reuse `TaskEvaluatorConfig` rather than define a creation-specific input struct?**

A creation-specific struct would let the stake field be dropped, since the backend never sets one.
But the struct that is stored and the struct that is passed being the same type is what makes the
shared `_applyEvaluatorConfig` body a straight copy with nothing to translate, and a translation
layer between two nearly-identical structs is exactly where a field quietly stops being carried.

**Why revert when evaluator terms are supplied without an evaluator?**

The alternative is to ignore them, which is what a zero-check-and-continue would do. Ignored terms
are never reported anywhere, so the requester believes the task is evaluator-gated for its entire
lifetime and finds out otherwise at settlement. A malformed request is worth a revert; a
misconfigured escrow is not recoverable.

**Why does `POST /api/tasks/{taskId}/evaluator` survive?**

Because it is not a workaround. A requester who decides on an evaluator after creating the task
has no other route, and will not have one after this revision. ADR-0047 named it the canonical
home for that case; this revision removes creation's dependence on it, not the capability.

---

## API Changes

**`createTask` signature.** Callers MUST encode the ten-parameter form. The trailing parameter is
`ITMPCore.TaskEvaluatorConfig` — `(address evaluator, uint256 evaluatorStake, uint16
evaluatorFeeBps, uint32 evaluationWindow, uint32 appealWindow, address disputeResolver)`. A task
with no evaluator passes the all-zero struct:

```
(0x0000000000000000000000000000000000000000, 0, 0, 0, 0, 0x0000000000000000000000000000000000000000)
```

The selector changes from `0xa595d889` to `0x95d5ec3f`, and rev016 removes the old selector from
the diamond. A caller that has not migrated does not silently create an unconfigured task; the
call reverts at the diamond's fallback. Clients that never set an evaluator need only re-encode.

| Change | Selector before | Selector after |
|---|---|---|
| `createTask` gains `TaskEvaluatorConfig` | `0xa595d889` | `0x95d5ec3f` |
| `assignEvaluator` (body only, unchanged ABI) | `0xa0c55b06` | unchanged |

**New errors.** `TaskAlreadyRefunded()` (`0xe6ac7a63`) from `refundExpired` on a task already
`Expired`; `NoRewardChange()` (`0x9a3bfd2b`) from `updateTask` when a caller names the reward it
already has. `FeeBpsTooHigh()` (`0x663885fb`), `InvalidEvaluator()` and
`EvaluatorAlreadyAssigned()` become reachable from `createTask` as well as `assignEvaluator`.

**Adding a custom error to a facet is not complete until the backend can decode it.** Relayed
calls are decoded against `FORWARDER_ABI`, so viem only ever supplies the raw selector and an
unmapped Diamond revert resolves to the string `unknown revert`. `classifyRelayFailure` treats
that as **transient** — deliberately, since wrongly abandoning recoverable work is the more
expensive mistake — and therefore retries it for ever. Both new errors are permanently true once
true, so an unmapped one is an intent that can never succeed and never stops asking. All three
selectors above are added to `KNOWN_ERRORS` in `apps/backend/src/services/contract.ts` in the same
change. This is API-visible, not an implementation detail: it decides whether a client's failed
write reports a reason or hangs.

**No REST or CLI surface changes.** `POST /api/tasks` already accepted `evaluator`,
`evaluatorFeeBps`, `evaluationWindowHours`, `appealWindowHours` and `disputeResolver`, and
`task create` already had `--evaluator` / `--evaluator-fee-bps`. Those inputs now reach the chain
in the create transaction rather than a follow-on, which is invisible to the caller except that it
can no longer fail after the escrow has been taken. The backend no longer records a
`tasks.assignEvaluator` relayed intent for a task created with an evaluator; a client reading the
intent surface (ADR-0049) for such a task will find one intent where it previously found two.

**`POST /api/tasks/{taskId}/evaluator` is unaffected** and remains the way to appoint an evaluator
to an already-live, unclaimed task.

**`getTask(taskId).reward` returns `0` for a settled expired task** (Problem 2's zeroing). The
value survives in the `TaskCreated` and `TaskExpired` events and in the indexed database row.

---

## Affected Files

| File | Change |
|---|---|
| `packages/contracts/src/facets/CoreFacet.sol` | `refundExpired` rejects `Expired`; both refund paths zero `task.reward`; `updateTask` reverts `NoRewardChange`; `createTask` takes `TaskEvaluatorConfig` and applies it via new private `_applyCreationEvaluatorConfig` |
| `packages/contracts/src/facets/EvaluatorFacet.sol` | `assignEvaluator` delegates validation, writes, stake pull and event to `LibTaskMarket._applyEvaluatorConfig`; NatSpec records why creation-time configuration is preferred |
| `packages/contracts/src/libraries/LibTaskMarket.sol` | Add `_applyEvaluatorConfig`, the shared evaluator-config body; import `ITMPEvaluator` |
| `packages/contracts/src/interfaces/ITMPCore.sol` | Add `error TaskAlreadyRefunded()` and `error NoRewardChange()`; `createTask` declaration gains `evaluatorConfig` |
| `packages/contracts/src/interfaces/ITMPDiamond.sol` | `createTask` declaration gains `evaluatorConfig` |
| `packages/contracts/script/upgrades/Rev016Upgrade.s.sol` | New: Remove old `createTask` selector, Replace 20 unchanged CoreFacet selectors, Add new `createTask`, Replace EvaluatorFacet; `diamondVersion` 15 → 16 |
| `packages/contracts/test/Rev016Upgrade.t.sol` | New: reconstructs pre-rev016 routing, applies the step, asserts the old selector is unrouted and both facets are replaced |
| `packages/contracts/test/TaskMarket.t.sol` | Escrow-liability tests (#432, duplicate-increase, solvency invariant); creation-with-evaluator tests including validation parity and the immediate-claim case |
| `packages/contracts/test/helpers/EvaluatorConfigHelper.sol` | New: `noEvaluatorConfig()` free function for the many call sites that create tasks without an evaluator |
| `packages/contracts/test/ITMP.t.sol`, `TaskMarketForwarder.t.sol`, `TaskTokenRewardHook.t.sol` | Pass the zero evaluator config to `createTask` |
| `packages/contracts/docs/specs/erc8195/erc-8195.md` | Add rev016 note on `createTask` requiring atomic evaluator configuration |
| `packages/contracts/.gas-snapshot` | Regenerated |
| `apps/backend/src/services/contract.ts` | `MARKET_ABI` `createTask` gains the evaluator tuple; `contractCreateTask` takes an optional `evaluatorConfig`; `KNOWN_ERRORS` gains `TaskAlreadyRefunded`, `NoRewardChange`, `FeeBpsTooHigh` |
| `apps/backend/src/services/intents/tasks-create-intent.ts` | Broadcaster passes the evaluator terms; completion writes the evaluator columns and no longer records or dispatches a `tasks.assignEvaluator` follow-on |
| `apps/backend/src/services/intents/register.ts` | `tasks.assignEvaluator` stays registered; comment records that its caller is the endpoint, not creation |
| `apps/backend/src/scripts/smoke-evaluator.ts` | Scenario D: creation with an evaluator is a single transaction |
| `apps/backend/src/scripts/smoke-nonce.ts` | Step 7 asserts no `tasks.assignEvaluator` intent exists for a task created with an evaluator |
| `apps/backend/test/unit/routers/tasks.test.ts` | Create-with-evaluator asserts the atomic path and the absence of a follow-on intent |

## References

- Issue #432 — repeatable `refundExpired`
- Issue #198, Issue #203 — the rev013 fixes in the same two functions
- [ADR-0054 — Settled liability is written with the money that settles it](../../../../../docs/adr/0054-settled-liability-is-written-with-the-money-that-settles-it.md)
- [ADR-0047 — Evaluator assignment is its own intent, and chaining is withdrawn](../../../../../docs/adr/0047-evaluator-assignment-is-its-own-intent-and-chaining-is-withdrawn.md)
- [ADR-0026 — Refunding an expired task is permissionless](../../../../../docs/adr/0026-refund-expired-is-permissionless.md)
- [ADR-0011 — Diamond selectors: single source and versioned upgrades](../../../../../docs/adr/0011-diamond-selectors-single-source-and-versioned-upgrades.md)
- `rev013-bounty-security-fixes.md` — the earlier fixes to `refundExpired` and `updateTask`
- `rev014-onchain-stake-config.md` — the previous `createTask` selector change

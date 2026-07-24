# 0029 — `processTaskCreatedEvent`'s reconciliation insert cannot recover off-chain-only `create()` inputs

> **Decision (Y-statement):** In the context of `processTaskCreatedEvent`'s reconciliation-only
> insert hardcoding `stakeRequired`/`stakeBps` to empty defaults when it has to reconstruct a task
> row from the bare `TaskCreated` event alone, facing the finding that these values were never
> written on-chain at task-creation time at all — so no additional contract read could recover
> them, unlike `contractAddress`/`platformFeeBps` — we decided to extend the on-chain `Task`
> struct and `createTask` to accept and store `stakeRequired`/`stakeBps` (rev014, ERC-8195) to
> achieve chain-recoverability matching `reward`/`mode`/`expiryTime`'s existing treatment,
> accepting a contract upgrade and that actual on-chain enforcement of the stake requirement at
> claim time remains a separate, unimplemented follow-up.

- **Status:** Accepted
- **Date:** 2026-07-23
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —

## Context

Issue #174 reports that `processTaskCreatedEvent` (`apps/backend/src/services/indexer.ts`)
hardcodes `stakeRequired: 0` / `stakeBps: 0` in its reconciliation-only insert, and proposes the
same fix already applied to `contractAddress`/`platformFeeBps` in a prior change: have the
handler make an additional `getTask()` read against the settlement contract
(`SETTLEMENT_READ_ABI` in `apps/backend/src/services/settlement-contract.ts`) and use the
on-chain value instead of a hardcoded default.

That fix did not work for `stakeRequired`/`stakeBps` as originally proposed, and investigating why
surfaced a broader gap than the issue describes:

- `CoreFacet.createTask` (`packages/contracts/src/facets/CoreFacet.sol`) took no stake-related
  parameter at all — its signature was `reward, duration, mode, pitchDeadline, bidDeadline,
  auctionSubtype, hookConfig, content`. The `TaskCreated` event it emitted carried only `taskId,
  requester, reward, mode, expiryTime`.
- `Task.stakeAmount` (the field `getTask()` would return) is zero-initialized at creation and
  only ever written by `claimTask(taskId, stakeAmount)` — a call the *worker* makes later, with
  a `stakeAmount` the worker chooses, not a value derived from the requester's original
  `stakeBps`. Calling `getTask()` immediately after processing a `TaskCreated` event — the exact
  moment `processTaskCreatedEvent` runs — would return `stakeAmount: 0` regardless of what the
  requester originally selected, because the worker has not claimed yet. This is a different
  field from `platformFeeBps`'s fix: `task.feeBps` genuinely is set inside `createTask` itself
  (`t.feeBps = s.defaultFeeBps`), so a `getTask()` read after `TaskCreated` returns the real
  value; `task.stakeAmount` was not.
- Confirmed further that `stakeRequired`/`stakeBps` are not currently enforced anywhere on-chain
  or off-chain at claim time either: `claims.router.ts`'s `claim()` calls `contractClaimTask`
  with a hardcoded `0n` stake regardless of the task's `stakeBps`, and the CLI's `task create`
  command hardcodes `stakeRequired: false, stakeBps: 0` on every call (it does not expose a way
  to set them). The web wizard (`create-task-wizard`, `step-brief.tsx`,
  `create-task-form.ts`) and dashboard/export code (`protocol-data.ts`, `task-export.ts`) do read
  and display these fields, so they are not fully dead — just not wired into the actual claim-time
  stake transfer.
- The same reconciliation insert already has the identical gap for other requester-customizable
  `create()` inputs that also have no on-chain equivalent: `description` (defaults to `''`),
  `requesterPubkey` (`''`), `tags` (`[]`), plus fields not set at all in the fallback insert
  (`pitchDeadline`, `bidDeadline`, `maxPrice`, `auctionType`, evaluator assignment,
  `hookContract`, `taskDropId`). `stakeRequired`/`stakeBps` are one instance of this pattern, not
  a special case — the on-chain fix below closes it only for `stakeRequired`/`stakeBps`; the rest
  of that gap remains open.

This reconciliation path only runs when `tasks.router.ts`'s synchronous `create()` insert failed
(e.g. the server crashed between the on-chain call and the DB write) and the indexer has to
rebuild the row from the bare event during catch-up — the same failure window ADR-0008's
`contractAddress` backfill work and PR #173 already hardened for the fields that *are*
recoverable from chain state. This ADR was originally about the fields that were not; the
on-chain change below moves `stakeRequired`/`stakeBps` into the "are recoverable" category.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Persist a durable "pending task creation intent" record (the full `create()` input, including `stakeRequired`/`stakeBps`, `description`, `tags`, etc.) *before* the on-chain call is made, keyed by a value known ahead of the on-chain `taskId` (e.g. a server-generated request id included in the forwarder call or correlated via `requester` + nonce); `processTaskCreatedEvent` looks this up and uses it to build the full row instead of guessing empty defaults, and it is cleaned up once the synchronous insert path succeeds normally (rejected for this decision) | Closes the gap for every off-chain-only field, not just `stakeBps` — matches the actual shape of the problem found during investigation; no contract change needed | New table and a new write on every task creation (including the vastly more common non-crash path); needs a reliable key to correlate the pending record with the eventual `taskId`, which is only derived on-chain inside `createTask` from `(chainid, address(this), requester, nonce)` — matching it back up requires either predicting that derivation off-chain before the call or accepting a short-lived requester+nonce lookup window |
| Extend the on-chain `Task` struct / `createTask` to accept and store `stakeBps`/`stakeRequired` (and emit them in `TaskCreated`), making them chain-recoverable the same way `reward`/`mode`/`expiryTime` already are (chosen) | Makes the reconciliation path fully correct for these two fields using the same pattern already proven for `contractAddress`/`platformFeeBps`; also a prerequisite for ever actually enforcing the stake requirement on-chain, which does not happen today | Diamond storage append plus an ABI/event change to `createTask`, gas-snapshot and forwarder call-site updates, and a contract upgrade; does not address the identical gap for `description`/`tags`/other off-chain-only fields, so it only closes part of the broader problem found |
| Leave the current hardcoded defaults in place, add a comment explaining why they cannot be fixed by an additional contract read the way `contractAddress`/`platformFeeBps` were, and stop pending a scoped decision (this ADR's original interim state, superseded by the decision below) | No new schema, table, or contract change; honest about what the code currently does instead of leaving a misleading impression that a `getTask()`-based fix was applied and works | Requester intent for `stakeRequired`/`stakeBps` (and the sibling fields) stays silently lost in the narrow crash-recovery window this handler exists for |

## Decision

Extend the on-chain `Task` struct and `createTask` to accept and store `stakeRequired`/
`stakeBps`, shipped as ERC-8195 revision 014 (`packages/contracts/docs/specs/erc8195/
rev014-onchain-stake-config.md`):

- `ITMPCore.Task` gains `bool stakeRequired; uint16 stakeBps;`, appended at the end per this
  codebase's append-only struct convention.
- `createTask` gains a new `ITMPCore.StakeConfig calldata stakeConfig` parameter (a
  `{ bool required; uint16 bps; }` struct, not two loose scalars — see rev014's Rationale for why
  two loose parameters reproduced a real "stack too deep" failure under the `--ir-minimum`
  coverage profile even though the default `via_ir` profile compiled them fine).
- `CoreFacet.createTask` validates `stakeConfig.bps <= 10000` (new `StakeBpsTooHigh` error,
  mirroring the existing `feeBps`/`FeeBpsTooHigh` pattern) and assigns both fields onto the
  stored `Task`.
- `TaskCreated` gains two new non-indexed fields, `stakeRequired`/`stakeBps`.
- `apps/backend/src/services/indexer.ts`'s `processTaskCreatedEvent` now decodes these directly
  from the `TaskCreated` event instead of hardcoding `0`/`0` — the reconciliation gap this ADR
  was opened for is closed for these two fields.
- `script/upgrades/Rev014Upgrade.s.sol` ships the upgrade (`createTask`'s selector changes, so
  this is a Remove-old/Replace-unchanged/Add-new cut on `CoreFacet`, not a pure Replace).

This decision does not implement on-chain enforcement of the stake requirement at claim time
(`claimTask`/`claims.router.ts` still accept an arbitrary worker-chosen `stakeAmount`) — that
remains a separate, unimplemented follow-up, tracked as a "Neutral / follow-up" item below rather
than blocking this change. It also does not address the identical off-chain-only-field gap for
`description`/`tags`/other `create()` inputs; the "durable pending-intent record" option above
remains available if that broader gap is prioritized later.

## Consequences

**Positive:**
- `stakeRequired`/`stakeBps` are now chain-recoverable the same way `reward`/`mode`/`expiryTime`
  already are, closing the specific data-loss window issue #174 reported.
- The fix follows this codebase's existing conventions closely: append-only struct field
  addition, a `HookConfig`/`TaskContent`-style packed calldata struct once the loose-scalar
  approach proved coverage-unsafe, and the established `RevNNNUpgrade.s.sol` versioned-upgrade
  pattern.

**Negative / trade-offs:**
- Requires a contract upgrade (`Rev014Upgrade.s.sol`) before the fix takes effect on any live
  deployment; diamonds not yet upgraded keep the old hardcoded-default behavior until then.
- No database backfill is possible for tasks created before the upgrade deploys, and none is
  written: the pre-rev014 `TaskCreated` event never carried `stakeRequired`/`stakeBps` at all, so
  if any historical task actually hit the narrow crash-recovery bug this ADR describes, its real
  values are permanently unrecoverable from chain state — there is nothing for a backfill script
  to read them back from, unlike `contractAddress` (recoverable from each task's own
  `escrow_tx_hash` receipt, see ADR-0008) or `task_awards` (recoverable by replaying settlement
  events). This fix only prevents the bug from recurring for tasks created after the upgrade.
- The identical reconciliation gap for `description`/`tags`/other off-chain-only `create()`
  inputs remains open — this decision only covers `stakeRequired`/`stakeBps`.
- `stakeRequired`/`stakeBps` are recorded on-chain but still not enforced against the worker's
  actual stake at claim time; a requester's stated requirement remains advisory/display-only
  until a follow-up wires `claimTask` to validate against it.

**Neutral / follow-up:**
- Wiring `claims.router.ts`'s `claim()` to validate the worker's chosen stake against
  `task.stakeBps * task.reward / 10000` (and deciding what happens on under-stake) is explicitly
  out of scope here and would need its own design decision.
- The `description`/`tags`/other-fields gap identified during this investigation is unresolved;
  if prioritized, the "durable pending-intent record" option above is the leading candidate.

## References

- Issue #174 (`stakeRequired`/`stakeBps` hardcoded to 0 in the reconciliation insert).
- `apps/backend/src/services/indexer.ts`, `processTaskCreatedEvent`.
- `apps/backend/src/routers/tasks.router.ts`, `create()` (the synchronous write this reconciles
  against).
- `apps/backend/src/services/settlement-contract.ts`, `SETTLEMENT_READ_ABI.getTask`.
- `packages/contracts/src/facets/CoreFacet.sol`, `createTask`/`claimTask`.
- `apps/backend/src/routers/claims.router.ts`, `claim()` (confirms `stakeBps` is not currently
  enforced at claim time either).
- `packages/contracts/docs/specs/erc8195/rev014-onchain-stake-config.md` (full implementation
  spec: before/after diffs, Rationale, API Changes, Affected Files).
- `packages/contracts/script/upgrades/Rev014Upgrade.s.sol` (the upgrade step).
- ADR-0008 (`contractAddress` recovery — the prior fix this issue modeled its proposed approach
  on, and the case where a `getTask()`-style read does work).

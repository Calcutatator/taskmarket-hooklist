# 0056 — createTask takes the evaluator configuration, and creation stops needing a second call

> **Decision (Y-statement):** In the context of a task that needs an evaluator, facing a contract
> API in which `createTask` accepted no evaluator configuration and `assignEvaluator` was gated on
> a task nobody had claimed yet, we decided to change `createTask`'s signature to take
> `TaskEvaluatorConfig` and apply it in the same transaction, replacing the old selector on the
> diamond rather than routing both, to achieve an evaluator that is configured the instant the
> task is live and a race that stops existing rather than being narrowed, accepting a selector
> change that breaks any unmigrated caller and one more parameter on the `ITMPCore` spec surface.

- **Status:** Proposed
- **Date:** 2026-08-04
- **Embodiment:** Verified
- **Last audited:** 2026-08-04
- **Author:** Claude (agent)
- **Reviewers:** (none recorded — awaiting review)
- **Deciders:** (none recorded — an agent may not self-approve)
- **Realized by:** packages/contracts/src/facets/CoreFacet.sol,
  packages/contracts/src/libraries/LibTaskMarket.sol,
  packages/contracts/script/upgrades/Rev018Upgrade.s.sol,
  apps/backend/src/services/intents/tasks-create-intent.ts
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** Amends ADR-0047
- **Pending Amends / Amended-by:** —

## Context

ADR-0047 stated the root cause in as many words and then deliberately did not fix it: *"the root
cause is a contract API gap (`createTask` takes no evaluator config, and `assignEvaluator`'s
`Open` gate is correct)"*. It listed the fix as a named follow-up requiring its own ADR, on the
grounds that `createTask` is part of the `ITMPCore` spec surface and that an additive function
might be the right shape instead. This is that ADR.

The gap is narrow and its consequences were not. `CoreFacet.createTask` took reward, duration,
mode, pitch and bid deadlines, auction subtype, stake config, hook config and content — and no
evaluator configuration. So configuring an evaluator meant a second transaction,
`EvaluatorFacet.assignEvaluator`, which reverts `TaskNotOpen` once a worker has claimed. The task
is claimable the instant `createTask` mines. Worker agents claim in milliseconds. There is a real
window, however short, in which the second call becomes permanently impossible for that task, and
no backend arrangement closes it.

Everything painful about evaluator assignment followed from that one gap rather than from
anything about intents. ADR-0046 built a general intent-chaining subsystem — parent links, depth
bounds, cycle detection, root resolution, a follow-on worker — presenting evaluator assignment as
the case that forced it, and in doing so moved the second call onto a ~10 s poll. ADR-0046's own
correction note records the result from a live sandbox run: 4 of 4 assignments sat at
`status: recorded` carrying `TaskNotOpen`, retried on every pass for ever, evaluators silently
never assigned, and nothing reporting a failure because nothing ever concluded one. ADR-0047
withdrew chaining and restored eager dispatch, which returned the race to its original width —
milliseconds — but explicitly did not close it, and recorded as a standing negative consequence
that "a requester whose task is claimed between creation and assignment cannot assign an evaluator
at all".

The current code therefore dispatches the follow-on eagerly from inside `completeTasksCreate` and
races the claim. It usually wins. "Usually" is the thing being fixed: a correctness property that
holds most of the time, silently fails the rest of the time, and cannot be made to hold by any
amount of care on the calling side.

Two constraints are not in question. `assignEvaluator`'s `Open` gate is substantively right —
appointing an evaluator to a task a worker has already claimed changes the terms the worker
committed to — and nothing here relaxes it. And appointing an evaluator to an already-live task is
a real capability that a requester who decides late genuinely needs; ADR-0047 named
`POST /api/tasks/{taskId}/evaluator` as its canonical home and that stays.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Change `createTask` to take `TaskEvaluatorConfig`; remove the old selector from the diamond (selected) | The window does not exist rather than being small, so there is no timing property to get right and none to regress; one transaction, one intent, one failure mode; the evaluator terms travel with the escrow on every rebroadcast attempt; validation lives in one shared body that both entry points call | A selector change, so any unmigrated caller breaks; one more parameter on a spec surface other implementors may follow; every in-repo `createTask` call site had to be updated |
| Add `createTaskWithEvaluator` alongside the existing `createTask` (rejected) | Purely additive; the existing selector keeps routing, so no caller anywhere breaks; the `ITMPCore` signature other implementors read is untouched | The two functions differ in one parameter, so the body has to be shared regardless and the only durable result is two selectors, two upgrade paths and two things to keep in step. Worse, it preserves the affordance that caused the defect: a caller wanting an evaluator can still pick the shape that needs a second transaction, and nothing tells them it races |
| Change the signature but route both selectors (rejected) | Migration-friendly; deployed clients keep working through a transition | A caller still encoding the 9-parameter form is a caller that believes evaluator terms cannot be set at creation. Honouring that call produces exactly the un-evaluated task this change exists to prevent — and produces it as a *success*, with no error anyone sees, indefinitely. The failure this is meant to eliminate would survive as the compatibility path |
| Relax `assignEvaluator`'s `Open` gate (rejected) | No signature change at all; the second call would always succeed | Bends a correct contract rule to fit a scheduling problem. An evaluator appointed after a worker claims changes the terms the worker accepted. ADR-0047 rejected this for the same reason and that reasoning stands |
| Keep the eager follow-on and accept the residual race (rejected) | No contract change, no upgrade, no migration | This is the status quo, and it is a correctness property that holds only probabilistically. When it fails it fails permanently for that task, and the requester has already paid |
| Introduce a creation-specific evaluator input struct without the stake field (rejected) | Slightly smaller calldata; the backend never sets an evaluator stake anyway | A translation layer between two nearly-identical structs is exactly where a field quietly stops being carried. Passing the same type that is stored is what makes the shared config body a straight copy with nothing to translate |

## Decision

**1. `createTask` takes `ITMPCore.TaskEvaluatorConfig` as a trailing parameter and applies it in
the same transaction.** A zero `evaluator` means the task has no evaluator. Evaluator terms
supplied with a zero evaluator revert `InvalidEvaluator` rather than being silently discarded: an
ignored configuration is never reported anywhere, so the requester would believe the task is
evaluator-gated for its whole lifetime and find out otherwise at settlement.

**2. No new storage.** `s.taskEvaluatorConfigs[taskId]` already holds exactly this struct, so
`AppStorage` is untouched. The append-only rule is not exercised because nothing is appended.

**3. Validation parity is achieved by sharing the code, not by copying the checks.** The
validation, storage writes, stake pull and `EvaluatorAssigned` event move into
`LibTaskMarket._applyEvaluatorConfig`, which both `createTask` and `assignEvaluator` call.
`assignEvaluator` keeps only `NotRequester` and `TaskNotOpen`, which are the two checks that
genuinely differ: on the creation path the requester is the authenticated sender by construction
and the task is `Open` by construction, so neither has anything to test. Two copies that agree
today are the arrangement in which the creation path eventually validates less than the assignment
path and becomes the way to bypass the difference — and the guard cheapest to skip is always the
one nobody has written yet.

**4. The old selector is removed from the diamond, not left routed alongside the new one.** See
the rejected option above; the migration path is in Consequences.

**5. Task creation no longer records or dispatches a `tasks.assignEvaluator` intent.** The
operation stays registered, because `POST /api/tasks/{taskId}/evaluator` is its caller and that
endpoint is a permanent feature. What goes away is creation's use of it. A task created with an
evaluator now has exactly one relayed intent, and it is the paid one.

## Consequences

**Positive:**

- The race is gone rather than narrow. There is no ordering to get right, so there is nothing to
  regress — which matters here specifically, because ADR-0046 regressed it once already by
  changing scheduling in a way nobody connected to evaluator assignment.
- A paid-for task can no longer end up half-configured. Previously the escrow could land and the
  evaluator never arrive, leaving the requester owed an effect rather than money — the case
  ADR-0047 recorded as unalerted and unbuilt.
- The evaluator terms are part of the create call, so a rebroadcast (ADR-0050) replays them
  verbatim along with everything else. Under the follow-on shape they depended on a second
  durable record that might not exist yet.
- One shared body means `InvalidEvaluator`, `EvaluatorAlreadyAssigned`, `FeeBpsTooHigh` and the
  stake pull cannot diverge between the two paths.
- ADR-0047's standing negative consequence — a requester whose task is claimed before assignment
  cannot assign an evaluator at all — no longer applies to the common case. It still applies to
  the genuinely-late case, where it is correct.

**Negative / trade-offs:**

- **Migration.** `createTask`'s parameter list changes, so its selector changes with it: the
  nine-scalar form gives way to one taking `TaskConfig`, `StakeConfig`, `HookConfig`,
  `TaskContent` and `TaskEvaluatorConfig`. Both selectors are `keccak256` of the signature, so
  neither is written down here — the signatures live in `CoreFacet.sol` (see **Realized by**) and
  `cast sig` derives the routing value from whichever one you are checking. The literal was
  recorded in prose twice before and was wrong both times, for the same reason: a value duplicated
  out of the code it is computed from goes stale the next time the code moves. The revision
  document is where an operator should read the shipped literals, because it records one specific
  cut and is meant to be compared against a block explorer.
  Anything still encoding the nine-parameter signature keeps working for the whole rev018 window
  and only reverts at the diamond's fallback once rev019 removes the shim. In-repo there is
  exactly one encoder — the hand-written viem ABI in `apps/backend/src/services/contract.ts` —
  updated in the same change. `TaskMarketForwarder` does **not** encode the selector itself: it
  relays whatever calldata it is handed and hashes the selector into its receipt, so it needs no
  redeployment and no change. Any third-party caller must re-encode before rev019; a task with no
  evaluator passes the all-zero struct. The eventual break is deliberate and loud, which is the
  point: a silent success would be worse than a revert.
- One more parameter on `ITMPCore.createTask`, which other implementors may follow. The spec note
  added to `erc-8195.md` states the requirement as normative rather than incidental.
- Every in-repo `createTask` call site had to be updated, which is a wide, mechanical diff across
  the Forge tests.
- Deploying this requires a `diamondCut` (rev018). The contract upgrade and the backend deploy are
  ordered, not independent, so the sequence below is part of the decision rather than an operator
  detail left to discover.

**Rollout.** The signature change ships expand-then-contract across two revisions, which is what
makes the cut zero-downtime:

1. **rev018 — the facet cut.** `Rev018Upgrade.s.sol` `Replace`s the existing CoreFacet selectors
   and `Add`s the new evaluator-aware `createTask`. The nine-parameter form is deliberately kept
   routed to a deprecated shim that forwards to the same shared body with an all-zero
   `TaskEvaluatorConfig`. After this step the diamond answers both selectors identically for a
   task with no evaluator, and every existing caller keeps working untouched.
2. **The backend deploy.** `apps/backend/src/services/contract.ts` starts encoding the new
   selector, so newly created tasks carry their evaluator terms atomically. Nothing forces this to
   be simultaneous with step 1, because step 1 broke nothing.
3. **rev019 — the removal.** Once nothing encodes the old form, `Rev019Upgrade.s.sol` removes the
   shim's selector and the ADR's end state is reached: one selector, no way to create a task by a
   route that cannot carry evaluator terms.

A caller still using the old form **during** the window succeeds and gets a task with no
evaluator, exactly as that signature has always meant — not a silent half-configuration, because
the old signature never accepted evaluator terms to begin with. **After** rev019 the same call
reverts at the diamond's fallback, which is the loud failure this ADR prefers to a silent one.

Rollback is independent on each side. Before rev019, the backend can be reverted to the old
encoding with no contract action at all, since the shim is still routed. The rev018 cut itself is
reversible by a `diamondCut` restoring the previous CoreFacet, and because it only added a
selector, reverting it strands nothing that existed before it. Reverting rev019 means re-adding
the shim's selector by cut — which is why step 3 waits on evidence that nothing calls it, rather
than following step 1 in the same deploy.

**Neutral / follow-up:**

- `POST /api/tasks/{taskId}/evaluator` is unchanged and remains the only route for appointing an
  evaluator after creation. Its `Open` gate still bounds it, correctly.
- The evaluator *stake* field is carried through the contract but the backend never sets one; a
  requester wanting a staked evaluator still goes through the endpoint. Whether creation should
  expose it is not decided here.
- ADR-0047's second named follow-up — modelling the x402 payment as the root of a chain, which is
  the case that would genuinely justify rebuilding chaining — is untouched by this and still open.
- The web wizard and `task create` needed no change: they already send these fields to
  `POST /api/tasks`, and the API shape is unchanged, so they take the atomic path automatically.

## References

- [ADR-0047 — Evaluator assignment is its own intent, and chaining is withdrawn](0047-evaluator-assignment-is-its-own-intent-and-chaining-is-withdrawn.md)
- [ADR-0046 — Relayed intents chain follow-on writes](0046-relayed-intents-chain-follow-on-writes.md)
- [ADR-0045 — Relayed writes are durable intents, not request-scoped transactions](0045-relayed-writes-are-durable-intents-not-request-scoped-transactions.md)
- [ADR-0011 — Diamond selectors: single source and versioned upgrades](0011-diamond-selectors-single-source-and-versioned-upgrades.md)
- `packages/contracts/docs/specs/erc8195/rev018-create-task-evaluator-config.md` — the shipped cut,
  and the place that records the literal selectors
- `packages/contracts/src/libraries/LibTaskMarket.sol` — `_applyEvaluatorConfig`, the shared body
- `packages/contracts/script/upgrades/Rev018Upgrade.s.sol` — the Replace/Add cut that keeps the
  legacy selector routed
- `packages/contracts/script/upgrades/Rev019Upgrade.s.sol` — the later cut that removes it

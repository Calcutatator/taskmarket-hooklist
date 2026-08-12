# 0065 — The backend decodes chain events from the generated ABI, and CI keeps that artifact current

> **Decision (Y-statement):** In the context of the backend decoding chain events and calls, facing
> an event set hand-transcribed in TypeScript sitting beside a generated ABI artifact that nothing
> imports, we decided to make the generated artifact the single source the backend consumes and to
> fail CI when it is stale, to achieve drift that is structurally impossible rather than merely
> unobserved, accepting that the backend now depends on a committed build artifact and that any CI
> job asserting its freshness must have Foundry available.

- **Status:** Accepted
- **Date:** 2026-08-05
- **Accepted:** 2026-08-05
- **Embodiment:** Not started
- **Last audited:** 2026-08-05
- **Author:** Claude Code (drafted for review)
- **Reviewers:** Beau Williams — self-attested; no independent reviewer recorded
- **Deciders:** Beau Williams
- **Supersedes / Superseded-by:** —
- **Amends / Amended-by:** —

## Context

The backend never reads the contracts. It reads a copy of them, written by hand.

`apps/backend/src/services/indexer.ts` builds every event it watches from inline `parseAbiItem`
string literals. `apps/backend/src/services/contract.ts` does the same for the call-side
`MARKET_ABI`. Neither is derived from the contracts; both are transcriptions of them.

A generated artifact already exists and is already current on every CI run. `make build contracts`
runs `forge build` and merges the ABI entries of the nine Diamond facets into
`packages/contracts/abi/TaskMarket.json`, which is committed and re-exported by
`packages/contracts/abi/index.ts`. CI's `quality-contracts` job installs Foundry and runs
`make build contracts` before its lint, test, snapshot, Slither and coverage steps.

Two gaps sit between those facts:

1. **Nothing imports the artifact.** `abi/index.ts` is imported by no file in `apps/backend` or
   `apps/web`. The generated ABI is dead weight beside a parallel hand-maintained copy.
2. **Nothing compares the regenerated artifact to the committed one.** CI regenerates it and then
   discards the result, so a stale committed artifact passes every check.

The failure mode is silent, which is what makes this worth deciding rather than leaving to care.
viem's `getLogs` filters by topic0: an event the backend does not list is never fetched, so it
never reaches a `default:` branch, never throws, and never logs. A signature that changed under a
name the backend still lists decodes into the wrong shape or not at all. Either way the database
diverges from the chain quietly, and the indexer is precisely the component whose job is to make
on-chain state authoritative.

An audit across the umbrella branch and rev016–rev020 found **no signature changes** — 55 distinct
events, each mapping to exactly one signature on every branch. That is a clean result, and it is
also luck: nothing in the repository would have caught a change if one had been made. It did find
one genuinely unhandled new event (`MinAppealWindowUpdated`, added in rev017), and several
pre-existing ones (`HookCallFailed`, `ReputationFeedbackFailed`) whose absence means an on-chain
failure is invisible to the backend.

This is the same shape as ADR-0011, one language boundary further out. That decision established a
single shared selector source because two hand-maintained lists had already drifted twice. The
same argument applies to the ABI the backend decodes against, and the same failure has not happened
yet only because the window has been short.

## Considered options

| Option | Pros | Cons |
| ------ | ---- | ---- |
| **A. Backend consumes the generated artifact; CI fails when it is stale** (chosen) | Removes the second source rather than checking it, so transcription drift cannot exist by construction; reuses machinery already in CI (Foundry installed, `make build contracts` already run); mirrors the existing `snapshot-check` pattern contributors already know | The backend gains a dependency on a committed build artifact; the freshness check needs Foundry in whichever job runs it; a merged-facet artifact is a slightly awkward shape for a Diamond, and does not cover the hook contracts |
| B. Generate at build time and stop committing the artifact (rejected) | No committed generated file; freshness is automatic | Every backend build — including a contributor running `pnpm build` with no Foundry installed — would need the contract toolchain. Trades a narrow drift risk for a broad build-environment dependency |
| C. Typed codegen on top of the generated artifact (selected, together with A) | A wrong event shape becomes a compile error rather than a runtime miss, and generated types are directly usable by agents and tooling rather than being a runtime-only JSON blob | A code generation step and its dependency to maintain. Does **not** on its own answer "does an event exist that we handle nowhere", because the indexer deliberately watches a subset and there is no exhaustive switch to lean on |
| D. Keep the hand-written set, add a test comparing it to the artifact (rejected) | Smallest diff; catches divergence | Leaves two sources of truth and adds a third thing to keep in sync. A comparison test tells you they disagree; it does not stop them disagreeing, and it is only as good as the artifact being current — which is the other half of the same problem |

## Decision

The generated ABI artifact is the source the backend decodes against. `apps/backend`'s indexer
reads its event definitions from `packages/contracts/abi/` rather than from inline literals.

**Typed bindings are generated from that artifact**, and consumers use the generated types rather
than the raw JSON. A wrong or removed event shape becomes a compile error rather than a runtime
miss, and the generated types are a usable interface for agents and tooling in a way a JSON blob
is not.

A freshness check regenerates the artifact and fails if it differs from what is committed, wired
into CI's existing `quality-contracts` job alongside the gas-snapshot check. The committed artifact
can therefore never be stale relative to the contracts. **Codegen does not remove this check** —
types generated from a stale artifact are stale types.

**A coverage assertion is retained alongside codegen**, because typing and coverage are different
properties and only one of them is settled by types. Typing answers "is this event's shape right".
Coverage answers "does an event exist that is handled nowhere" — and codegen cannot answer it here,
because the indexer deliberately watches a subset of events, so there is no exhaustive switch for
the type system to check against. The assertion reduces to: every event name in the generated
artifact appears in either the indexed set or an explicit, commented `UNINDEXED` allowlist. The
allowlist is what carries intent, recording that an event was seen and deliberately not projected
rather than merely forgotten.

The check is **not** added to the pre-commit hook. It requires `forge build`, and that hook already
runs lint, type-check, format, skill conformance and two ADR passes across sixteen packages. Making
it slower is how a hook starts being bypassed.

## Consequences

**Positive:**

- Transcription drift between the contracts and the backend's view of them becomes structurally
  impossible rather than merely unobserved.
- A new or changed event fails the build instead of silently not being fetched.
- The generated artifact stops being dead weight and starts being load-bearing, which is also what
  keeps it correct — an unused artifact is an unchecked one.
- The next revision's author gets a clear signal at the point of change rather than a quiet
  divergence discovered later from a stale database.

**Negative / trade-offs:**

- The backend depends on a committed build artifact. Regenerating it becomes part of changing a
  contract, in the same way regenerating the gas snapshot already is.
- The freshness check requires Foundry in the job that runs it. That cost is already paid in
  `quality-contracts`; it constrains where the check may live.
- The generated artifact merges only the nine Diamond facets. The hook contracts — `RewardVault`,
  `EpochBudget` and `TaskTokenRewardHook`, all live — are not in it, so indexing their events needs
  either an extension of the merge script or a second artifact. This decision does not settle
  which; it only requires that whatever is used is generated rather than transcribed.
- An allowlist is a place where an unindexed event can be parked and forgotten. It is better than
  silence because it is visible in review, but it is not self-clearing.

- Codegen adds a build step and a dependency, and the generated output is one more artifact whose
  freshness has to be gated rather than assumed.

**Neutral / follow-up:**

- `contract.ts`'s call-side `MARKET_ABI` is the same hand-transcription problem on the write path
  and is deliberately out of scope here, to keep this change reviewable. It should follow, and
  benefits from the same generated types.
- This does not change what the indexer projects, only where its definitions come from. Adding
  handling for currently-unindexed events is separate work.
- The exact codegen tool is not fixed by this decision, only that bindings are generated from the
  committed artifact rather than written by hand. Whatever is chosen must emit types from the
  artifact the freshness check already gates, so that one regeneration step covers both.

## References

- `docs/adr/0011-diamond-selectors-single-source-and-versioned-upgrades.md` — the same
  single-source argument one language boundary earlier.
- `docs/adr/0005-indexer-blocks-on-failed-event-instead-of-skipping.md` and
  `docs/adr/0007-indexer-status-transitions-are-guarded-by-prior-state.md` — existing indexer
  correctness decisions this sits beneath.
- `Makefile` — `make build contracts`, which generates `packages/contracts/abi/TaskMarket.json`.
- `.github/workflows/ci.yml` — the `quality-contracts` job, where the freshness check belongs.
- `apps/backend/src/services/indexer.ts` — the inline `parseAbiItem` definitions being replaced.

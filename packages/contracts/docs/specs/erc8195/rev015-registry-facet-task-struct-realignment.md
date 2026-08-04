# ERC-8195 Revision 015 — Redeploy `RegistryFacet` so `getTask()` Returns the rev014 `Task` Shape

> **Backfilled 2026-08-04.** This revision shipped in PR #278 (commit `2ff1f17c`, 2026-07-25)
> without a revision document — the upgrade script, its test and the gas snapshot were added, but
> `rev000-revision-process.md`'s requirement was missed. This document is reconstructed from
> primary sources only: the commit message, the NatSpec on `script/upgrades/Rev015Upgrade.s.sol`,
> `test/Rev015Upgrade.t.sol`, and the referenced PRs. Nothing here is inferred about intent beyond
> what those state. The Rationale section is thinner than a contemporaneous document's would be,
> and that is a real cost of backfilling rather than a stylistic choice.

## Motivation

Revision 014 added `stakeRequired` and `stakeBps` to the shared `ITMPCore.Task` struct and updated
`CoreFacet.createTask` to write them. Its `diamondCut` replaced `CoreFacet` — and only `CoreFacet`.

`RegistryFacet.getTask()` returns `ITMPCore.Task memory` **by value**. A facet's deployed bytecode
ABI-encodes whatever struct shape it was compiled against, and that shape is fixed at deploy time
regardless of what the struct looks like in current source. So after rev014, source declared a
14-field `Task` while the live `RegistryFacet` still encoded the pre-rev014 12-field tuple. This was
confirmed directly against mainnet with `cast`: `getTask()` returned 384 bytes where current source
implied 448.

That is the general hazard this revision exists to record: **changing a shared struct silently
changes the ABI of every facet that returns it by value, including facets the change never
touched.** A `diamondCut` that replaces only the facet whose logic changed leaves every other
returner encoding a stale shape, with nothing in the source tree indicating a mismatch.

## Problem 1 — `getTask()` returned a stale tuple shape, crashing the indexer

`RegistryFacet.getTask()` returned the 12-field pre-rev014 tuple while the backend's ABI declared
the 14-field version. The first time the indexer decoded a task settled after rev014, viem read past
the actual return data and threw, crashing the backend's startup event-replay.

The failure was in the consumer, but the cause was on chain: two facets of one diamond disagreed
about the shape of a struct they both claim to speak.

PR #274 addressed the symptom separately and correctly, by reverting the backend's ABI to the
12-field shape actually live. That is forward-compatible rather than a temporary patch — viem's
tuple decoding needs only the declared prefix, so the backend stays correct whether or not this
upgrade has been applied. This revision closes the underlying gap: after it, `getTask()` genuinely
returns `stakeRequired`/`stakeBps` on chain to every caller, matching source.

## Changes

### 1. Replace `RegistryFacet` across its full selector set

`Rev015Upgrade.s.sol` performs a single `Replace` covering every selector in
`FacetSelectors.registryFacetSelectors()`, guarded on `diamondVersion() == 14` and setting it to 15.

No selector's **signature** changed — only `getTask`'s return *type* widened, and a return type is
not part of a function selector. So this is a pure `Replace` with no `Remove`/`Add` pair, unlike
rev014's `createTask`, whose parameter list changed and therefore whose selector changed.

```solidity
uint256 private constant EXPECTED_PRE_VERSION = 14;
uint256 private constant TARGET_VERSION = 15;
```

No source file under `src/` changed in this revision. The fix is entirely a redeploy: the facet's
Solidity was already correct against the current struct; only its deployed bytecode was stale.

## Rationale

### Why not leave it, since PR #274 had already stopped the crash?

#274 made the backend tolerate the live shape, which stops the outage but leaves source and chain
disagreeing about what `Task` is. Every future reader of `getTask()` — a new service, an external
integrator, a script — would have to know that current source does not describe live behaviour.
The workaround is correct and stays correct; it is not a reason to leave the chain wrong.

### Why not fold this into a later revision?

The mismatch was live on mainnet and had already caused one production crash. Deferring it would
have meant every subsequent revision inheriting a diamond whose facets disagree.

### Why a pure `Replace` rather than `Remove` then `Add`?

Selectors are computed from name and parameter types, not return types, so every `RegistryFacet`
selector is unchanged. `Remove`/`Add` would produce an identical end state with a window mid-cut
where the selectors route nowhere.

## API Changes

`getTask(bytes32)` returns a 14-field tuple after this upgrade, where it previously returned 12.
The two added fields, `stakeRequired` and `stakeBps`, were introduced to the struct by rev014.

This is additive at the end of the tuple, so ABI-decoders that declare only the first 12 fields
continue to work — which is what makes PR #274's backend revert safe across the upgrade boundary in
both directions. Callers wanting the new fields must declare the full 14-field shape **and** be
talking to a diamond at version 15 or later.

## Affected Files

| File | Change |
| --- | --- |
| `packages/contracts/script/upgrades/Rev015Upgrade.s.sol` | New. Replaces `RegistryFacet` across its full selector set; guards `diamondVersion() == 14`, sets 15. |
| `packages/contracts/test/Rev015Upgrade.t.sol` | New. Deploys at the rev011 baseline, advances through rev012/013/014, applies rev015, asserts the version bump and that every `RegistryFacet` selector still routes to the new implementation. |
| `packages/contracts/.gas-snapshot` | Regenerated for the new upgrade test. |

## References

- PR #278 (`2ff1f17c`) — the change this document records
- PR #274 — the backend ABI revert that stopped the indexer crash independently
- [rev014 — Record `stakeRequired`/`stakeBps` On-Chain at Task Creation](rev014-onchain-stake-config.md) — added the struct fields and replaced only `CoreFacet`
- [rev011 — Diamond selectors, single source and versioned upgrades](rev011-diamond-selectors-single-source-and-versioned-upgrades.md) — the versioned-upgrade mechanism this follows
- ADR-0029 — the decision rev014 implemented

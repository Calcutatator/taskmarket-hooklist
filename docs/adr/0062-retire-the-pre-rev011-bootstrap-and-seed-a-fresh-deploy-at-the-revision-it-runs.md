# 0062 — Retire the pre-rev011 bootstrap and seed a fresh deploy at the revision it runs

> **Decision (Y-statement):** In the context of upgrading and deploying the TaskMarket diamond,
> facing a bootstrap script no live diamond can reach that nonetheless has to be edited every
> revision and collides with the versioned step scripts when it is, we decided to delete
> `DiamondFullUpgrade.s.sol`, seed `diamondVersion` from the revision a build actually runs, and
> rebuild the parity test over the whole upgrade pipeline as ADR-0011 originally specified, to
> achieve a version counter that cannot disagree with the deployed code, accepting that no
> automated path remains to recover a pre-rev011 diamond should one ever be found.

- **Status:** Accepted
- **Date:** 2026-08-05
- **Embodiment:** Not started
- **Last audited:** 2026-08-05
- **Author:** Claude Code (drafted for review)
- **Reviewers:** Beau Williams — self-attested; no independent reviewer recorded
- **Deciders:** Beau Williams
- **Supersedes / Superseded-by:** —
- **Amends / Amended-by:** Amends ADR-0011

## Context

ADR-0011 introduced `diamondVersion` and per-revision upgrade step scripts, and kept
`DiamondFullUpgrade.s.sol` as a legacy bootstrap: three loupe-detected paths (A/B/C) that carry a
diamond from whatever historical selector state it is in up to rev011, after which the
`RevNNNUpgrade.s.sol` steps take over one revision at a time. `script/upgrade.sh` runs the
bootstrap only when `diamondVersion()` reads 0.

Three facts about that arrangement have since come apart.

**1. No diamond that could use the bootstrap exists.** Verified on chain on 2026-08-05:
`diamondVersion()` reads **15** on both the Base Mainnet diamond
(`0xddc6cc3e4d11c1f3527b867c7dad4ed9869c33f7`) and the Base Sepolia diamond
(`0x0A24E9c3b9E31B8258329e187470ACc16497Cec7`). Both are version-tracked and past rev011, so
`upgrade.sh` never takes the bootstrap branch. Paths A, B, and C are unreachable in production.

**2. A fresh deploy reports a version it is not running.** `AdminFacet.initialize()` hardcodes
`s.diamondVersion = 11`. A deploy today builds every facet from current source and routes the
current selector set, then stamps itself 11. The counter is therefore not a fact about the code;
it is a constant left over from when 11 was current. `Rev012Upgrade.t.sol` asserts this
(`"fresh deploy must start at rev011"`), which cements the mismatch rather than catching it.

The consequence is not cosmetic. On a newly deployed chain, `make upgrade` reads 11, correctly
skips the bootstrap, then applies rev012 onward because every target exceeds 11. It does not get
far. `Rev014Upgrade` opens with a **Remove** of the pre-rev014 `createTask` selector
(`Rev014Upgrade.s.sol:49`), which a fresh deploy never installed, and `LibDiamond` reverts
`FunctionNotFound`. Were that step passed, `Rev017Upgrade` would then issue an **Add** for
`minAppealWindowSecs`/`setMinAppealWindowSecs`, which a fresh deploy already routes, and
`LibDiamond` rejects an Add for an existing selector.

The general shape: the step scripts encode deltas from real historical states, while a fresh
deploy is already at the destination. Every step that is not a pure Replace re-attempts an
operation that is already satisfied, and each such attempt is a revert rather than a no-op.

**3. The parity test enforces the wrong invariant, and that is what breaks the bootstrap.**
ADR-0011 decision item 4 specified a test that deploys fresh, *separately runs the full versioned
upgrade sequence from a simulated old state*, and asserts both reach an identical selector set —
naming it "the actual enforcement mechanism". What shipped
(`DiamondSelectorParity.t.sol::test_FreshDeploy_MatchesFullUpgradePathC`) compares a fresh deploy
against **Path C alone**, not against the sequence.

Because a fresh deploy routes today's complete selector set, keeping that test green forces Path C
to acquire each new revision's selectors while still calling `setDiamondVersion(11)`. Path C now
adds rev017's two selectors (`cuts[10]`) and stamps 11; `Rev017Upgrade` later tries to Add the
same two and reverts. Paths A and B were never edited and do not have this problem, so the three
paths no longer agree with each other.

This recurs every revision and through both cut actions. rev017 collides on **Add**. rev018 grows
`coreFacetSelectors()` from 21 to 22 entries, so Path C's wholesale
`_replaceCut(coreFacet, coreFacetSelectors())` would attempt to **Replace** a selector a
pre-rev011 diamond does not route, which `LibDiamond` also rejects. rev019 removes a selector, a
third variant. Each revision pays the same tax to keep unreachable code compiling against a test
asserting something that stopped being true at rev012.

## Considered options

| Option | Pros | Cons |
| ------ | ---- | ---- |
| **A. Retire the bootstrap, seed the version from the build, rebuild parity over the full pipeline** (chosen) | Removes the recurring per-revision tax outright; makes `diamondVersion` a fact about the code rather than a constant; finishes ADR-0011 item 4 as written; the pipeline invariant is self-maintaining as revisions land and would have caught this class of bug | Loses any automated recovery path for a pre-rev011 diamond; touches deploy-path code for a defect with no live victim; needs the live-version claim verified before deletion |
| B. Repair Path C for rev017 and keep the bootstrap (rejected) | Smallest diff; preserves the recovery path | Pays the tax again at rev018, rev019, and every revision after; leaves Path C stamping a version that contradicts the code it installed; leaves paths A/B/C disagreeing |
| C. Make every non-pure-Replace step idempotent against an already-satisfied selector state, by loupe-checking before each Add/Remove (rejected) | Fixes both the fresh-deploy break and the Path C collision without deleting anything; keeps the version scheme and the bootstrap intact | Papers over the divergence instead of removing it — a step script that silently accepts either state can no longer assert what it upgraded *from*, which is the precondition guard ADR-0011 added on purpose; the version counter still lies; and the guard must be added to every past and future step that Adds or Removes, which is the same recurring tax in a new place |
| D. Leave it alone as dead code (rejected) | Zero work; no live diamond is affected today | Fact 2 is not dead code — a fresh deploy on a new chain is broken right now, and every sandbox/Anvil diamond in dev already reports 11 while running current bytecode |

## Decision

Delete `DiamondFullUpgrade.s.sol` and its three migration paths. Seed `diamondVersion` at
initialize time from the revision the build actually corresponds to, rather than the literal 11.
Replace `test_FreshDeploy_MatchesFullUpgradePathC` with the invariant ADR-0011 item 4 specified: a
fresh deploy and the full `RevNNNUpgrade` sequence must converge on the same per-facet selector
set. Add an accompanying assertion that a fresh deploy's `diamondVersion` equals the highest
`RevNNNUpgrade` target, so the seed cannot silently fall behind again.

This ships as **rev020**, stacked on top of the rev019 branch rather than based directly on `main`.
Basing it on `main` was considered and rejected: `main`'s highest upgrade step is `Rev015Upgrade`,
so a fresh deploy there would seed at 15 while rev016–rev019 sat unmerged on branches, and the new
"seed equals the highest step target" assertion would be rewritten the moment those landed.
Stacking on rev019 lets rev020 see the complete step sequence it is asserting over, at the cost of
inheriting the stack's merge order.

## Consequences

**Positive:**

- `diamondVersion` becomes derivable from the build instead of asserted by a constant, so a
  diamond can no longer report a revision it is not running.
- A new-chain deployment can run `make upgrade` without reverting.
- The recurring per-revision edit to unreachable bootstrap code disappears, along with the
  Add/Replace/Remove collision class it kept regenerating.
- The parity test starts enforcing what ADR-0011 said it should, and would catch a future
  divergence between a fresh deploy and the upgrade path.

**Negative / trade-offs:**

- No automated path remains to bring a pre-rev011 diamond forward. If one is ever discovered, the
  cut has to be reconstructed by hand from git history. This is the substance of the decision, and
  it rests on fact 1 — verified at version 15 on both live diamonds at decision time, but a
  deployment outside those two (a partner fork, an abandoned test chain) would not have been seen
  by that check.
- Seeding the version from the build means the existing `RevNNNUpgrade` tests can no longer start
  from a fresh deploy at 11 and advance; `setDiamondVersion` refuses to decrease
  (`DiamondVersionNotIncreasing`), so those fixtures need reworking. That is real work this ADR
  does not scope.
- Deleting the paths removes the historical selector-set helpers (`_regPreIntegritySelectors`,
  `_coreExistingSelectors`, and peers), which are the only in-repo record of what those old
  diamonds routed. Git history retains it, but it stops being discoverable in the tree.

**Neutral / follow-up:**

- Does not change the external interface of `make deploy` / `make upgrade`.
- The existing `RevNNNUpgrade` step scripts and their preconditions are unaffected.
- A `rev020-*.md` revision doc under `packages/contracts/docs/specs/erc8195/` should accompany the
  implementation, per the convention that contract rationale travels with the mirrored package.
  That doc, and every comment in `packages/contracts/`, must use the `revNNN` convention and must
  **not** reference this or any ADR by number: the package is mirrored publicly, `docs/adr/` is
  not, so an `ADR-NNNN` citation there would be a dangling reference for every reader of the
  mirror. This is the same rule ADR-0011 states for itself.
- This does not address a separate, already-documented limitation: the `RevNNNUpgrade` tests
  advance a diamond built from *current* bytecode, so they do not exercise genuine historical
  facet code. That is orthogonal and remains open.

## References

- `docs/adr/0011-diamond-selectors-single-source-and-versioned-upgrades.md` — decision items 3
  and 4, which this amends.
- `packages/contracts/script/DiamondFullUpgrade.s.sol` — the bootstrap being retired.
- `packages/contracts/script/upgrade.sh` — the sequencer whose bootstrap branch is unreachable.
- `packages/contracts/src/facets/AdminFacet.sol` — `initialize()`, line 46, the hardcoded seed.
- `packages/contracts/test/DiamondSelectorParity.t.sol` — the partial implementation of ADR-0011
  item 4.
- `packages/contracts/test/Rev012Upgrade.t.sol` — asserts the 11 seed a fresh deploy must produce.
- `packages/contracts/docs/specs/erc8195/rev011-diamond-selectors-single-source-and-versioned-upgrades.md`

# 0011 — Diamond facet selectors get one shared source of truth, and upgrades become explicit versioned steps

> **Decision (Y-statement):** In the context of `DiamondDeploy.s.sol` and
> `DiamondFullUpgrade.s.sol` each hand-maintaining independent selector lists for the same
> facets (issue #161, directly caused issue #160), facing a choice between adopting a
> third-party diffing tool (gemforge) or refactoring the existing Foundry scripts in-house, we
> decided to extract one shared selector-list source per facet plus an explicit on-chain
> `diamondVersion` counter with discrete, individually-versioned upgrade step scripts, to
> achieve a single source of truth for "what a facet's selectors are" without adding a new
> external dependency to the deploy pipeline, accepting that a shared list is still hand-written
> (versus gemforge's structural auto-discovery from compiled bytecode) and requires a
> selector-set-parity test to fully close the gap.

- **Status:** Accepted
- **Date:** 2026-07-20
- **Embodiment:** Implemented
- **Last audited:** 2026-07-28
- **Author:** Beau Williams
- **Reviewers:** Beau Williams — self-attested; no independent reviewer recorded
- **Deciders:** Beau Williams
- **Supersedes / Superseded-by:** —

## Context

`DiamondDeploy.s.sol` (fresh deploy) and `DiamondFullUpgrade.s.sol` (live upgrade) each
independently hand-maintain a `bytes4[]` selector list per facet. When `rejectSubmission` was
added to `CoreFacet.sol`, only the upgrade script's list was updated — the fresh-deploy script's
list silently drifted out of sync, and nothing caught it, because nothing diffs the two lists
against each other or against the compiled contract's actual function set (issue #160, fixed in
PR #158). The same failure mode was independently found and fixed again during this repo's own
preview-environment work: `DiamondDeploy.s.sol`'s `AdminFacet` selector list was missing
`setDefaultHooks`/`getDefaultHooks`, selectors that exist in the deployed contract and in
`DiamondFullUpgrade.s.sol`'s list but were never backfilled into the fresh-deploy script. Two
independent instances of the identical bug, on two different facets, is the signal that this is
structural, not a one-off (issue #161).

Separately, `DiamondFullUpgrade.s.sol`'s migration logic infers a diamond's current state
indirectly, by checking for the presence/absence of specific old selectors
(`Path A`/`Path B`/`Path C`, detected via `IDiamondLoupe.facetAddress(OLD_SELECTOR)`). This
works for the three historical states that exist today, but has no explicit notion of "version"
— every future revision needs another hand-coded path with its own selector-presence detection,
and there is no way to upgrade a diamond that is multiple revisions behind in one command
without manually chaining path logic. This repo already solves the equivalent problem for the
database (`apps/backend/drizzle/migrations/`: sequential numbered files, a journal tracking the
last-applied migration, `migrate()` applying every pending one in order) — the diamond has no
equivalent.

Two external tools were researched as alternatives to fixing this in-house:

- **[gemforge](https://gemforge.xyz/)** — a CLI tool that auto-discovers facet-to-selector
  mapping directly from compiled Solidity (whatever function lives in `CoreFacet.sol`
  automatically belongs to CoreFacet's selector set) and computes `diamondCut()` by diffing
  compiled artifacts against live on-chain bytecode. Structurally cannot drift, because there is
  no hand-written list at all. Confirmed to genuinely support Foundry (`artifacts.format:
  "foundry"`) via a real production example: [Tribally-Games/arcade-contracts](https://github.com/Tribally-Games/arcade-contracts)
  has a real Base mainnet (chainId 8453) Diamond deployment recorded in
  `gemforge.deployments.json` with a live transaction hash. However, that repo's sole
  contributor is `hiddentao` — the same individual who is gemforge's primary maintainer (173 of
  gemforge's own commits). This is the tool author's own project, not independent third-party
  validation. Combined with gemforge's small footprint (21 GitHub stars, 4 forks, single
  primary maintainer, ~9 months since last commit as of this writing) and no evidence of
  independent security review, this is a real bus-factor and trust-boundary risk for a tool that
  would compute and broadcast `diamondCut()` transactions against a live diamond holding real
  escrowed funds.
- **[SolidState](https://github.com/solidstate-network/solidstate-solidity)** — an
  "upgradeable-first" Solidity source library (pre-built base contracts for ERC20/721/1155,
  access control, diamond storage helpers). Operates at a different layer entirely: it is
  something facet contracts would inherit from, not a deploy/upgrade tool. Adopting it would
  mean rewriting this repo's existing, already-deployed-to-mainnet facets to inherit from it,
  and would not by itself solve the selector-list-drift problem — some deploy/upgrade tooling
  (gemforge, or this ADR's approach) would still be needed on top of it regardless. Not a
  substitute for either option; out of scope here.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Shared selector source + versioned upgrade steps (chosen) | No new external dependency in the deploy pipeline — stays entirely in reviewed, tested Foundry scripts this team already owns; failure mode if the shared source is wrong is a plain, reviewable `bytes4[]` array (same category of mistake as today, just with only one place to make it); explicit `diamondVersion` replaces indirect selector-presence inference, enabling a diamond N revisions behind to upgrade to current in one command | Still a hand-written list, not auto-discovered from bytecode — a selector can still be added to a facet and never added to `FacetSelectors.sol` at all; needs a new selector-set-parity test to fully close that residual gap |
| Adopt gemforge (rejected) | Structurally eliminates hand-written selector lists entirely, since facet membership is auto-discovered from compiled Solidity; real `--dry`/pause+`cut.json` review step before broadcasting; genuine Foundry support | Hands `diamondCut()` computation for a live, fund-holding diamond to a single-maintainer, ~21-star external tool whose only production reference is the maintainer's own repo, not independent adoption; a bug in its diffing logic is a categorically worse failure (wrong cut silently computed and broadcast) than today's failure mode (a reviewable missing array entry); no evidence of independent security review |
| SolidState (rejected) | Well-regarded diamond-pattern base library; could improve facet code quality longer-term | Wrong layer — a source library, not deploy tooling; does not address the selector-list-drift bug at all; adopting it means rewriting already-deployed mainnet facets, with deploy/upgrade tooling (this ADR's approach or gemforge) still needed on top regardless |

## Decision

1. Extract one shared, canonical selector-list function per facet into
   `packages/contracts/script/lib/FacetSelectors.sol`. `DiamondDeploy.s.sol` and the
   steady-state/target-state portions of the upgrade tooling both call these shared functions
   instead of maintaining independent copies. Migration-specific "existing"/"new"/rev-numbered
   incremental subset functions (needed to compute deltas *from* old historical states) have no
   fresh-deploy equivalent and are not unified — they represent genuinely different, historical
   information.
2. Add an explicit `uint256 diamondVersion` field to the end of `AppStorage` (append-only, per
   this repo's existing storage-layout convention) and an `AdminFacet.diamondVersion()` view.
3. Replace the monolithic `DiamondFullUpgrade.s.sol` with discrete, individually-versioned
   upgrade step scripts — one per revision — each of which checks the diamond is at its expected
   pre-upgrade version (reverting if not, preventing an out-of-order or double-applied step),
   applies its own delta, and bumps `diamondVersion`. A single command applies every
   not-yet-applied step in sequence, so a diamond several versions behind reaches current in one
   run — mirroring this repo's own Drizzle migration-journal pattern for the database.
4. Add a Foundry test that deploys a diamond fresh via `DiamondDeploy.s.sol`, separately runs
   the full versioned upgrade sequence from a simulated old state, and asserts both end up with
   an identical selector set per facet via `IDiamondLoupe.facets()`. This is the actual
   enforcement mechanism — the shared source reduces the chance of drift, but this test is what
   guarantees it cannot silently reoccur even if a future edit re-introduces a second list by
   mistake.

## Implementation notes

- **Revision numbering, not ADR numbering, in the contracts package.** `packages/contracts/`
  has a public mirror, so its comments use this codebase's existing `rev00N` convention
  (`rev007`, `rev008`, ...) exclusively — never `ADR-NNNN`. ADR cross-references stay inside
  `docs/adr/`, which is not mirrored. This upgrade is **rev011** (rev010 was already taken by
  the `setDefaultHooks`/hooks work).
- **`diamondVersion` is seeded at 11, not 1.** Since each diamond upgrade already corresponds to
  one of this codebase's numbered revisions, the counter is backfilled to match that existing
  numbering on its first write (`AdminFacet.initialize()` for a fresh deploy; `setDiamondVersion`
  for every `DiamondFullUpgrade.s.sol` path) rather than starting a parallel "version 1" scheme.
  The next real upgrade after this one lands — the first to exercise the new tracked-version
  flow end to end — will be rev012, bumping `diamondVersion` from 11 to 12.
- **Item 3 shipped as an explicit version guard on the existing three paths, not a physical
  split into separate per-revision script files.** `DiamondFullUpgrade.s.sol` still auto-detects
  Path A/B/C via the existing loupe-based selector-presence checks (that detection logic is
  itself historical and out of scope for this change — it is what gets a diamond to rev011 in
  the first place). What changed: all three paths now also add
  `AdminFacet.diamondVersion()`/`setDiamondVersion()` and call `setDiamondVersion(11)` once their
  cut lands, so from rev011 onward a diamond's version is an explicit on-chain fact instead of
  something inferred. There is no rev012 content yet to decompose into a separate step script —
  the "one script per future revision, applied in sequence" shape described above is what the
  *next* upgrade will exercise for the first time, not something this PR needed to build ahead of
  having a second version to apply.

## Consequences

**Positive:**
- The exact failure mode that caused issue #160 (and its independent recurrence on `AdminFacet`
  during this repo's own preview-environment work) becomes structurally harder to reintroduce:
  there is one list to update per facet, not two-or-more, and a test fails immediately if they
  ever diverge.
- No new external dependency added to a security-adjacent deploy pipeline; every line of the
  fix stays in Foundry scripts this team already reads, tests, and reviews via normal PR flow.
- `diamondVersion` gives an explicit, queryable answer to "what state is this diamond in" for
  both scripts and humans, replacing indirect inference from selector presence/absence — and
  directly enables upgrading a diamond that is multiple revisions behind in a single command.

**Negative / trade-offs:**
- `FacetSelectors.sol` is still a hand-written list, not auto-discovered from compiled bytecode
  the way gemforge's approach is — a developer can still add a function to a facet and forget to
  add it to `FacetSelectors.sol` at all (as opposed to forgetting to sync it *between* two
  lists). The selector-set-parity test (decision item 4) is what catches this in practice, but
  it depends on that test actually being run and kept passing.
- Breaking `DiamondFullUpgrade.s.sol` into per-version step scripts is a larger refactor than
  the minimal "share one function" fix alone — more files, more surface area to review in this
  PR — in exchange for closing the separate version-inference fragility, not just the
  selector-duplication bug.
- gemforge remains available as a future option if this team's risk tolerance or gemforge's own
  maturity signals change; nothing in this decision precludes revisiting it later via a
  superseding ADR.

**Neutral / follow-up:**
- This does not change `make deploy`/`make upgrade`'s external interface — network selection,
  environment variables, and CI wiring are unaffected.
- A future ADR could reconsider gemforge (or an equivalent) once/if it shows broader independent
  adoption and a larger maintainer base, without needing to unwind this decision — the shared
  selector source and version tracking added here are not gemforge-incompatible.

## References

- Issue [#160](https://github.com/daydreamsai/taskmarket/issues/160), [#161](https://github.com/daydreamsai/taskmarket/issues/161).
- PR #158 (original `rejectSubmission` selector-drift fix).
- `packages/contracts/script/DiamondDeploy.s.sol`, `DiamondFullUpgrade.s.sol`.
- `apps/backend/drizzle/migrations/meta/_journal.json` (the existing DB-migration pattern this
  mirrors).
- [gemforge](https://gemforge.xyz/), [gemstation/gemforge](https://github.com/gemstation/gemforge),
  [Tribally-Games/arcade-contracts](https://github.com/Tribally-Games/arcade-contracts).
- [solidstate-network/solidstate-solidity](https://github.com/solidstate-network/solidstate-solidity).

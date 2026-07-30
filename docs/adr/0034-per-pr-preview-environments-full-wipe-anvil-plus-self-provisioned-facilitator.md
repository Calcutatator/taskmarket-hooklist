# 0034 — Per-PR preview environments: full redeploy per commit, disposable Anvil, self-provisioned facilitator

> **Decision (Y-statement):** In the context of coding agents needing an isolated testnet
> environment per PR to push commits, deploy contracts, and verify end-to-end behavior without
> colliding with other agents' in-flight work or the real shared testnet, facing Railway's
> native PR-environment automation being invisible outside its dashboard, cloned from a broken
> base template, and only isolating the database while every environment still shared one
> on-chain diamond and deployer key, we decided to replace it with an explicit
> `deploy-preview.yml` workflow that fully tears down and redeploys each PR's environment
> (app services, Postgres, a disposable Anvil chain masquerading as Base Sepolia, and a
> self-provisioned X402 facilitator) on every commit, to achieve a fully isolated,
> repo-legible, wallet-free preview environment per PR, accepting a full-rebuild latency cost
> per push and no state surviving across commits within the same PR.

- **Status:** Accepted
- **Date:** 2026-07-30
- **Embodiment:** Implemented
- **Last audited:** 2026-07-30 (Realized-by hash refresh attested by beauwilliams (via gh))
- **Author:** Beau
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —
- **Amends / Amended-by:** —
- **Realized by:** .github/workflows/deploy-preview.yml@60a3b469bc21649bdb541f65728d6d19652e8a59, packages/contracts/src/mocks/MockUSDC.sol@4c88bf45d1b53b3b729249a932bad68d8a135574

## Context

Agents working in parallel on separate PRs had nowhere safe to verify their changes. The real
shared testnet is one environment with one Postgres and one deployed diamond on Base Sepolia —
two agents testing task/bounty flows at once would corrupt each other's on-chain and database
state. Railway's built-in PR-environment feature (`prDeploys`/`botPrEnvironments`) was already
enabled but cloned its configuration from a known-broken `preview` base template, invisible
outside the Railway dashboard to any agent or human reading the codebase — and even working, it
only isolated Postgres: every environment's backend still pointed at the same
`FORGE_DIAMOND_ADDRESS_TESTNET` on the one shared chain, so on-chain state was never isolated at
all.

This decision was designed and written up in detail as `docs/rfc/0002-agent-preview-environments.md`
(Draft), then built and confirmed live end-to-end against a real Railway deploy — but no ADR was
ever drafted to formally capture it, leaving a deep-review audit (issue #362) unable to reconcile
the RFC's "now implemented and verified live" claim against anything in `docs/adr/`. This ADR is
that retroactive capture, drafted once the deep-review pass surfaced the gap. RFC-0002's own
`Status` moves to `Accepted` alongside this ADR, per this repo's RFC lifecycle convention
(`docs/rfc/README.md`: `Accepted` means "built — spawns its own ADR(s)").

## Considered options

*(Reproduced from RFC-0002's own "Alternatives considered" section — the analysis was already
done at design time; not re-litigated here.)*

| Option | Pros | Cons |
|---|---|---|
| **Full teardown + redeploy per commit, disposable Anvil, self-provisioned facilitator (chosen)** | Fully isolated (DB, chain, contracts) per PR; entire lifecycle legible as a repo-checked-in workflow, not a dashboard setting; no funded wallet or gas cost, since the chain never leaves the environment's private network | Full rebuild latency per pushed commit; no state survives across commits within a PR |
| Real Base Sepolia deploy per PR environment | Uses the real target chain | Needs a funded deployer wallet shared across every parallel agent, faucet/gas contention, slower turnaround, reintroduces the exact shared-state collision problem this decision exists to solve |
| Persistent chain per PR / conditional wipe (keep one Anvil alive across commits, reset only on contract-touching commits) | Avoids full-rebuild latency on app-only commits | Contract-touching commits would force a live diamond cut (`make upgrade`) whose failure modes (storage-layout rules, facet-selector diffing) fail PRs for reasons unrelated to the change under review; chain and DB must be wiped together or kept together, forcing migrations-always-additive plus real partial-drift edge cases the unconditional wipe eliminates entirely |
| Keep Railway's native bot PR-environment feature as-is | Zero new workflow to build | Configuration invisible outside the Railway dashboard; current base template is broken |

## Decision

`deploy-preview.yml` (triggered on `pull_request: [opened, synchronize, reopened, closed]`) fully
tears down and recreates each PR's Railway environment on every commit — all services including
Postgres, plus a dedicated `anvil` service. Once Anvil is healthy, `make deploy testnet`
(`DiamondDeploy.s.sol`, never `make upgrade` — these environments are always freshly empty, so
upgrade-path failure modes like storage-layout diffing don't apply) deploys against it, signed
by one of Anvil's well-known pre-funded dev accounts — safe specifically because the chain never
leaves that one ephemeral environment's private network. Contract addresses and the Anvil RPC
URL are written into the environment's Railway variables; the backend runs its normal
migration-on-boot; the environment's URL is commented on the PR.

X402 payment verification needs a **facilitator** service pointed at the right chain, not just a
chain and a backend. Three pieces make this work on a disposable chain: (1) `deploy-preview.yml`
self-provisions a facilitator instance per environment from the public `daydreamsai/facilitator`
package, no credentials or vendoring needed; (2) the disposable Anvil runs with `--chain-id 84532`
and the facilitator gets an explicit RPC override so the fixed `base-sepolia` network identity it
already validates against resolves to the disposable chain instead of the real one; (3)
`packages/contracts/src/mocks/MockUSDC.sol` implements EIP-3009 (`transferWithAuthorization`/
`receiveWithAuthorization`, matching the backend's default EIP-712 domain) since X402's `exact`
settlement scheme requires it and a plain ERC20 stand-in reverts at settlement regardless of
facilitator configuration.

## Consequences

**Positive:**
- Every PR gets a fully isolated environment (DB, chain, contracts) with no shared-state
  collision risk between parallel agents.
- The entire lifecycle is a checked-in GitHub Actions workflow, not an invisible dashboard
  setting — any agent or engineer reading the repo can see and modify how it works.
- No funded, shared testnet wallet needed for routine per-PR contract deploys — the disposable
  chain's dev accounts are pre-funded and never touch a real network.

**Negative / trade-offs:**
- Every pushed commit pays a full environment rebuild. The Railway app-service redeploy
  (minutes) is unavoidable under any design once code changes; the Anvil boot plus contract
  deploy adds only seconds on top.
- State does not survive across commits within the same PR — a bug that only reproduces after a
  multi-step sequence built up across earlier commits must be replayed after every push. Narrower
  than it first appears: Anvil's `evm_increaseTime`/`anvil_setNextBlockTimestamp` cover
  time-based bugs (task expiry, epoch resets, auction end times) without needing real elapsed
  time at all; the real gap is state built up across separate commits, plus the rarer case of a
  bug that only reproduces under real-world chain conditions rather than simulated time.

**Neutral / follow-up:**
- X402 payment settlement through the deployed facilitator on a disposable per-PR chain has been
  wired but not yet exercised live end-to-end — the infra itself (environment lifecycle, Anvil,
  contract deploys, facilitator service, URL resolution) is confirmed live; the settlement path
  specifically is not.
- Railway billing/quota impact of creating and destroying a full environment (4 services +
  Postgres) on every commit across potentially many concurrent PRs has not been checked — worth
  confirming before this becomes the routine per-push path at higher PR volume.
- A `make seed-testnet`-style fast re-seed helper (replay a full task lifecycle through the API
  in one command) would mitigate the state-doesn't-survive-commits limitation; not built for v1.
- Railway's `PROJECT_SANDBOXES` checkpoint/fork primitive could replace "full redeploy on every
  commit" with "checkpoint right after initial contract deploy, fork from that checkpoint on
  later commits" — much faster, but the feature flag isn't enabled on this project yet. Revisit
  if/when it becomes available.
- The `FORGE_DEV_PRIVATE_KEY` testnet/mainnet key-sharing issue that motivated part of this
  design remains open, tracked separately — this ADR does not fix it.

## References

- `docs/rfc/0002-agent-preview-environments.md` — the full design document this ADR formally
  captures; status moves to `Accepted` alongside this ADR.
- ADR-0002 — the `testnet` environment rename/deploy-on-merge decision this design builds
  alongside.
- Deep-review issue #362 — surfaced the missing-ADR gap that prompted this retroactive capture.

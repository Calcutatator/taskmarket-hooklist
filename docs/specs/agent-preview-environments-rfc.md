# Agent Preview Environments RFC

Status: Draft, no decision recorded yet
Owner: Taskmarket
Last updated: 2026-07-13

This is an RFC: a design proposal for discussion, not a decision record. Once a direction is
chosen, the decision itself belongs in an ADR under `docs/adr/` (see `docs/adr/README.md`
for the process) — a human must explicitly approve that ADR before it's considered decided.
This document should not be read as already-approved.

## Summary

Coding agents (Hermes-class, and eventually Discord-triggered cloud agents) need a testnet
environment per PR where they can push commits, deploy contracts, and verify end-to-end
behavior without colliding with other agents' in-flight work or with the real shared
testnet. This RFC proposes replacing Railway's dashboard-configured, invisible PR-environment
automation with an explicit `deploy-preview.yml` GitHub Actions workflow that provisions a fresh
Railway environment plus a disposable Anvil chain for every PR, redeployed from scratch on
every commit.

## Problem

Agents working in parallel on separate PRs currently have nowhere safe to verify their
changes:

- The real shared testnet (the `testnet` Railway environment, serving
  `testnet-market.daydreams.systems` — at the time this problem was written, confusingly
  named `production`; renamed since, see ADR-0002) is a single environment with a single
  Postgres and a single deployed diamond contract on Base Sepolia. Two agents testing
  task/bounty flows at the same time would corrupt each other's on-chain and database state.
- Railway's built-in PR-environment feature is already enabled on the project (`prDeploys`,
  `botPrEnvironments`, `focusedPrEnvironments` are all `true`), and does give each PR its own
  Postgres. But it clones its service configuration from a `baseEnvironmentId` pointing at
  the `preview` environment, which is known broken, and none of this configuration exists
  anywhere in the repo — it is set only in the Railway dashboard, invisible to an agent (or a
  human) reading the codebase.
- Even a working PR-environment feature only isolates the database. Every environment's
  backend still points at the same `FORGE_DIAMOND_ADDRESS_TESTNET` on the one shared Base
  Sepolia chain, so on-chain task/bounty state is not isolated between PRs at all.
- The contract deployer key is also shared across networks: `DiamondDeploy.s.sol` and
  `DiamondFullUpgrade.s.sol` both read `FORGE_DEV_PRIVATE_KEY` regardless of whether the
  target is testnet or mainnet — unlike every other `FORGE_*` variable, which has a
  `_TESTNET`/`_MAINNET` split. Provisioning per-PR environments with real testnet deploys
  would mean handing that same key to every agent, or building a funded-wallet-per-environment
  system.

## Current State (updated after this RFC's design was implemented and verified live)

Project: `TASK MARKET` (`31b1179a-c6f5-42da-a0aa-58231c519ce2`)

Environments:
- `taskmarket.io` — real production; deployed to only by `.github/workflows/deploy-production.yml`
  (formerly `deploy.yml`), gated on a `v*` git tag and a passing `quality` CI check.
- `testnet` — the shared testnet chain (`testnet-market.daydreams.systems`,
  `testnet-api-market`, `testnet-market-docs`). Renamed from a misleading `production` label to
  match reality (ADR-0002) — no DNS impact, environment renames are cosmetic only. Deployed to
  automatically by `.github/workflows/deploy-testnet.yml` on every merge to `main` (app
  code only; contract upgrades stay a separate manual `make upgrade testnet` step).
- `preview` — the base template `deploy-preview.yml` (formerly `preview.yml`) duplicates fresh
  for every PR. Its services had inherited a stale native GitHub branch connection watching
  `main`, silently fighting the CLI-driven deploys on every PR environment — disconnected.
- `taskmarket-pr-<N>` — created explicitly by `deploy-preview.yml` per PR, torn down on close.
  Railway's own native PR-environment bot separately created some stale ephemeral environments
  for older PRs before it stopped doing so for new ones; those are historical leftovers, not
  something this workflow depends on or races against going forward.

Services in every environment: `@taskmarket/backend`, `@taskmarket/frontend`,
`@taskmarket/docs`, `Postgres`.

CI/CD as it exists in the repo today:
- `ci.yml` — full quality gate (lint, type-check, tests, gas snapshot, Slither, coverage,
  Playwright) on push to `main` and on PRs.
- `deploy-production.yml` — deploys backend/web/docs to the `taskmarket.io` Railway
  environment, triggered only by pushing a `v*` tag.
- `deploy-testnet.yml` — deploys backend/web/docs to the `testnet` Railway environment,
  triggered via `workflow_run` once `ci.yml` completes successfully on `main` (ADR-0002; no
  separate `testnet` branch).
- `deploy-preview.yml` — the per-PR preview environment this RFC proposes, now implemented
  and live-verified (see "Testing the CLI against a preview environment" below).
- `sandbox-smoke.yml` — runs `scripts/cloud-env-setup.sh` inside a real Linux container
  whenever the sandbox script, its Dockerfile, or the Makefile change.

## Documentation-process inconsistency found while writing this

While placing this RFC, we found the repo has no settled convention for where pre-decision
design documents live. `docs/specs/erc8195-delegation-chains.md` is a "proposal" in
`docs/specs/`; `docs/PLATFORM_SKILL_CONFORMANCE_PRD.md` is a "PRD" sitting at `docs/` root.
Same kind of document, two names, two locations, nothing written down saying which is
correct. This RFC follows the `docs/specs/` precedent and this repo now has an explicit
`docs/adr/` process for decisions (see `docs/adr/README.md`), but the existing PRD's
placement is left untouched — moving or renaming it is a separate decision, not bundled into
this change.

## Goals

- Give every PR (and, by extension, every agent working on a PR) an isolated environment: its
  own Postgres, its own deployed contracts, its own chain state.
- Make the entire preview-environment lifecycle legible in the repository as a GitHub Actions
  workflow, not a Railway dashboard setting — so any agent or engineer reading the codebase
  can see and modify how it works.
- Avoid any dependency on a funded, shared testnet wallet for routine per-PR contract deploys.
- Give the agent a reachable URL for its own environment (surfaced via the PR comment in step
  6 below) so it can drive the running app through a browser and iterate against real
  behavior, not just unit tests, without leaving its own PR.
- Fit the human-in-the-loop model in `docs/adr/README.md`: the agent works unattended inside
  its own PR environment for ordinary implementation choices, and only pauses for a human when
  it hits a decision that belongs in an ADR.

## Non-goals

- Replacing or reconfiguring the real shared testnet (`testnet` environment) or its
  deploy/upgrade process.
- Fixing the `FORGE_DEV_PRIVATE_KEY` testnet/mainnet key-sharing issue — noted here because it
  motivates part of the design, but tracked as a separate, smaller fix.
- Building a system for testing against real Base Sepolia per PR (see Alternatives).

## Proposed Design

### Stop relying on Railway's native PR-environment automation

Disable the project-level `prDeploys` / `botPrEnvironments` bot integration once confirmed
nothing else currently depends on it, so Railway stops auto-cloning new environments from the
broken `preview` base. This is a project-wide setting change and needs explicit sign-off
before it's flipped, separate from writing the new workflow.

### `deploy-preview.yml` GitHub Actions workflow

Triggered on `pull_request: [opened, synchronize, reopened, closed]`.

On open or new commit (`synchronize`):

1. Tear down and fully recreate the PR's Railway environment (all services, including
   Postgres) via the Railway CLI (`railway environment delete` then
   `railway environment new pr-<N> --duplicate preview`). Every commit gets a completely
   fresh environment — no partial state carried forward, regardless of whether the commit
   touched contracts.
2. Deploy `@taskmarket/backend`, `@taskmarket/frontend`, `@taskmarket/docs` (`railway up
   --service <name> --environment pr-<N>`), plus a dedicated `anvil` service (created once via
   `railway add --service anvil --image <foundry image>` in the base template, running `anvil
   --host 0.0.0.0`, then cloned automatically by `--duplicate` on every subsequent PR).
3. Once Anvil is healthy, run `make deploy testnet` (`DiamondDeploy.s.sol`) against its RPC
   URL, signing with one of Anvil's well-known, pre-funded default dev accounts (e.g. account
   #0). This is safe specifically because the chain only ever exists inside that one
   ephemeral environment's private network and never touches a real chain — no wallet
   provisioning or funding required.
4. Write the resulting contract addresses and the Anvil RPC URL into that environment's
   Railway variables.
5. Backend runs its normal migration-on-boot (no manual migrate step needed).
6. Comment the environment's URL on the PR.

On close: delete the environment.

### Never use `make upgrade testnet` for these environments

`make upgrade testnet` (`DiamondFullUpgrade.s.sol`) exists to preserve a diamond's proxy
address and storage across a contract change on a persistent chain, where redeploying isn't
an option. Per-PR Anvil chains have no such constraint — they are always freshly deployed and
freshly empty — so every PR-environment deploy uses `make deploy testnet`, never `upgrade`.
Using `upgrade` here would only import unrelated failure modes (storage-layout diffing,
facet-selector pinning) into a sandbox that doesn't need them.

### The facilitator: X402 payments on a disposable chain

Payer-gated endpoints (anything the smoke tests hit via `x402Post`) do not work with just a
chain and a backend: X402 payment verification and settlement go through a **facilitator**
service (`daydreamsai/facilitator`; the backend's `X402_FACILITATOR_URL` defaults to the
production instance at `facilitator.daydreams.systems`). The production facilitator
verifies against the real Base Sepolia RPC, so payments referencing a disposable Anvil
chain would fail. Every isolated environment therefore needs its own facilitator wired to
its own chain. Three pieces:

1. **A facilitator instance per environment.** The `daydreamsai/facilitator` repo is
   public (and published to npm as `@daydreamsai/facilitator`), so no credentials, scope
   widening, or monorepo vendoring is needed. In the agent sandbox: the setup script
   clones it and runs it as another local Bun process. In the Railway preview
   environment: `deploy-preview.yml` self-provisions it — creates the project-level service from
   the public repo if it doesn't exist yet (first run ever), then sets its variables
   per-environment on every run. The backend's `X402_FACILITATOR_URL` points at it in
   both cases. No manual setup step.
2. **Chain identity: Base Sepolia masquerade.** The facilitator validates networks against
   a fixed supported list (chain id 84532 = `base-sepolia`), and the backend derives its
   X402 network string from `CHAIN_ID`. Rather than teaching either about a new chain, the
   disposable Anvil runs with `--chain-id 84532` and the facilitator gets
   `EVM_NETWORKS=base-sepolia` plus `EVM_RPC_URL_BASE_SEPOLIA=<the environment's anvil
   RPC>` — the explicit RPC override wins its resolution order, so "base-sepolia" resolves
   to the disposable chain. Backend `CHAIN_ID=84532` completes the alignment. Safe because
   the chain never leaves the environment's private network.
3. **The mock USDC must be EIP-3009 capable — a hard requirement, met by `MockUSDC`.**
   X402's `exact` scheme settles via `transferWithAuthorization` (EIP-3009) on the payment
   token; the real testnet/mainnet deployments satisfy this by using Circle's actual USDC
   contracts, which do not exist on a fresh Anvil chain, and a plain ERC20 stand-in
   reverts at settlement regardless of facilitator configuration.
   `src/mocks/MockUSDC.sol` — the repo's single, general-purpose mock USDC, used by the
   Forge test suite and by `DeployMockUSDCPreview` alike — implements EIP-3009 (both
   `transferWithAuthorization` overloads plus `receiveWithAuthorization`,
   authorization-state tracking, EIP-712 domain matching the backend's default
   `USD Coin`/version `2` so no backend configuration is needed).

All three pieces are wired: the sandbox setup script clones and starts the public
facilitator against the masqueraded chain and deploys `MockUSDC`; `deploy-preview.yml`
self-provisions the facilitator service and points it at each PR's anvil. The `deploy-preview.yml`
infra itself (environment lifecycle, anvil, contract deploys, facilitator service, URL
resolution) is now confirmed live end to end against a real Railway deploy. X402 payment
settlement through the deployed facilitator on a disposable per-PR chain has not yet been
exercised live -- that piece remains open.

### Testing the CLI against a preview environment

The CLI (`@lucid-agents/taskmarket`) resolves its backend from the `TASKMARKET_API_URL`
environment variable (`apps/cli/src/lib/api.ts`), defaulting to production. Two cases:

- **Using the CLI to exercise a preview environment** (backend/contract PRs): point the
  published CLI at the environment's backend URL — `TASKMARKET_API_URL=https://<pr-backend
  domain> taskmarket ...`. Nothing to build.
- **PRs that change the CLI itself**: there is no per-environment npm publish, and none is
  needed — the CLI under test is the source sitting in the PR's own branch. Run it from
  source: `pnpm --filter @lucid-agents/taskmarket build` then `node apps/cli/dist/index.js`,
  or `pnpm dev` (tsx) for uncompiled iteration, with `TASKMARKET_API_URL` pointing at the
  PR's preview backend. The smoke tests already follow this pattern -- `_x402.ts` reads the
  same `TASKMARKET_API_URL` the CLI does, so one variable covers both (`cd apps/cli &&
  TASKMARKET_API_URL=... pnpm smoke:xmtp-live`).

Publishing per-environment npm packages was considered and rejected: it adds a registry
round-trip and version-churn noise to every PR for something running the branch's own source
already does correctly.

## Alternatives Considered

- **Real Base Sepolia deploy per PR environment.** Rejected: needs a funded deployer wallet
  shared across every parallel agent, faucet/gas contention, slower per-push turnaround, and
  reintroduces exactly the shared-state collision problem this RFC exists to solve.
- **Persistent chain per PR / conditional wipe** (keep one Anvil chain alive across commits
  within a PR, only resetting when a commit touches `packages/contracts/**` — or never,
  using `make upgrade` for contract changes). This is technically possible: the anvil service
  has no reason to redeploy on app-only commits, and Anvil supports state persistence
  (`--state`, `anvil_dumpState`/`anvil_loadState`). Rejected knowingly, not for
  impossibility: (1) contract-touching commits leave the deployed diamond's bytecode stale,
  forcing a live diamond cut (`make upgrade`) whose failure modes — storage-layout rules,
  facet-selector diffing — would fail PRs for reasons unrelated to the change under review;
  (2) the backend indexes chain events into Postgres, so chain and DB must be wiped together
  or kept together, and keeping both forces migrations-always-additive plus exactly the
  partial-drift edge cases the unconditional wipe eliminates. Unconditional full wipe on
  every commit is simpler and always in sync with HEAD. The future speed win is the
  `PROJECT_SANDBOXES` checkpoint/fork path in Open Questions (fresh-state semantics without
  re-running the deploy script), not persistence.
- **Keep Railway's native bot PR-environment feature as-is.** Rejected: its configuration is
  invisible outside the Railway dashboard, and its current base template (`preview`) is
  broken.

## Accepted Limitations

### Latency per commit

Every pushed commit pays a full environment rebuild. Decomposed, though, the wipe itself is
not the slow part:

- Railway rebuild and redeploy of backend/frontend/docs: **minutes**, and unavoidable under
  any design — the code changed, so the app services must redeploy whether or not the chain
  persists.
- Anvil boot plus `forge script` deploying the diamond to it: **seconds**. Anvil mines
  instantly with no block-time waits. Fresh Postgres plus migrations-on-boot: also seconds.

A real testnet would not fix this — Base Sepolia is slower per iteration (real block times
and confirmations) on top of costing real gas. The realistic options are "minutes, free,
isolated" (this design) or "more minutes, real money, shared" (testnet). The rebuild price is
also paid per pushed commit, not per action: within one deployed preview an agent iterates
freely — browser, smoke tests, chain time-travel, DB inspection — without triggering a
rebuild. Mitigations if the per-push minutes become the bottleneck: Railway build caching,
and the `PROJECT_SANDBOXES` checkpoint/fork path in Open Questions.

### State does not survive commits

Wiping the environment on every commit means bugs that only reproduce after a multi-step
sequence built up across earlier commits in the same PR (e.g. "create a task on commit 1,
push a fix on commit 2, then try to accept that same task") cannot be verified in place — the
setup steps must be replayed after every push. Mitigation, not required for v1: a
`make seed-testnet`-style script that replays a full task lifecycle through the API in one
command.

Note this is narrower than it first appears: Anvil supports `evm_increaseTime` /
`anvil_setNextBlockTimestamp`, so time-based bugs (task expiry, `FORGE_EPOCH_DURATION_TESTNET`
resets, submission windows, auction end times) do not require real elapsed time at all — an
agent can fast-forward its own PR environment's chain deterministically over its own RPC
endpoint. The only real gap is state built up across separate commits within one PR, and the
rarer case of a bug that only reproduces after real-world chain conditions (real gas markets,
real block timing variance) rather than simulated time — for that narrow case, the shared
persistent testnet remains the right, more expensive, contended fallback.

## Open Questions

- Confirm nothing currently depends on Railway's native `botPrEnvironments`/`prDeploys`
  behavior before disabling it.
- Exact Anvil service definition (Dockerfile, health check, Railway service config).
- Railway billing/quota impact of creating and destroying a full environment (4 services +
  Postgres) on every commit across potentially many concurrent PRs — worth checking before
  this becomes the routine per-push path.
- Whether and when to build the `make seed-testnet` fast re-seed helper described above.
- Railway's `sandbox` primitive (ephemeral compute with `fork`/`checkpoint` semantics) could
  replace "full redeploy on every commit" with "checkpoint the chain right after initial
  contract deploy, fork from that checkpoint on later commits" — much faster than re-running
  `forge script` every push. Not usable today: it requires the `PROJECT_SANDBOXES` feature
  flag, which is not enabled on the TASK MARKET project (`featureFlags: []` as of this
  writing). Worth revisiting once/if that flag is available.
- The `FORGE_DEV_PRIVATE_KEY` testnet/mainnet key-sharing issue is out of scope here but
  should be tracked separately.

## Next Step

Once discussion settles, record the outcome as an ADR in `docs/adr/` using
`docs/adr/template.md`, with status `Proposed` until a human explicitly approves it.

# 0001 — Mainnet contract upgrades stay manual and developer-local

> **Decision (Y-statement):** In the context of the agentic development factory's release
> path, facing the question of who may execute mainnet diamond cuts and how the mainnet
> owner key is custodied, we decided to keep mainnet upgrades exactly as they are today —
> run manually by a developer from their local machine via `make upgrade mainnet` — to
> achieve zero new attack surface on the key that controls the production protocol,
> accepting that mainnet releases remain a human bottleneck that agents cannot automate.

- **Status:** Accepted
- **Date:** 2026-07-13
- **Embodiment:** Inactive
- **Last audited:** 2026-07-29
- **Author:** Beau
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —

## Context

The agentic development factory RFC (`docs/rfc/0003-agentic-development-factory.md`)
defines a release ladder from per-PR preview environments up to the persistent chains. Every
rung below mainnet can be safely automated: preview deploys use throwaway Anvil keys,
upgrade rehearsals use fork-mode Anvil with an impersonated owner (no real key present), and
the testnet upgrade can run in CI once the testnet deployer key is split from mainnet's. The
top rung — cutting the live mainnet diamond — requires the real owner key, which controls
the production protocol and its escrowed funds. Where that key lives and who may use it had
to be decided before any part of the release path is automated around it.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Manual, developer-local (`make upgrade mainnet` from a trusted machine) | Zero new attack surface; key never leaves developer custody; identical to current practice, nothing to build | Mainnet releases bottleneck on a developer being available; no audit trail beyond the chain itself |
| CI-executed behind a GitHub protected-environment approval gate (rejected) | Repeatable, logged, still human-approved | The owner key moves into GitHub secrets — a far larger attack surface (org compromise, actions supply chain) for the highest-value key the project holds |
| Multisig/timelock as diamond owner, agents propose cuts, humans sign (rejected for now) | Structurally sound end-state; key custody becomes protocol-level rather than procedural | Real engineering and operational cost; not justified before the factory itself is proven |

## Decision

Mainnet contract upgrades remain exactly as they are today: a developer runs
`make upgrade mainnet` manually from their local machine. No CI execution, no agent
involvement, no change to owner-key custody. This is not a temporary placeholder pending
automation — it is the decided model, and any future move away from it (e.g. to a multisig
owner) requires a new ADR superseding this one.

## Consequences

**Positive:**
- The mainnet owner key never enters GitHub secrets, CI logs, or any agent-reachable
  environment.
- The factory's automation boundary is unambiguous: agents automate everything up to and
  including testnet; mainnet is out of bounds by decision, not by omission.

**Negative / trade-offs:**
- Mainnet release cadence is bounded by developer availability.
- No structured audit trail of who ran an upgrade beyond on-chain evidence and team
  communication.

**Neutral / follow-up:**
- The testnet/mainnet deployer key split (the shared `FORGE_DEV_PRIVATE_KEY` issue) is still
  required — it is what makes automating the testnet rung safe while this ADR keeps mainnet
  manual.

## References

- RFC: `docs/rfc/0003-agentic-development-factory.md` (release path section)
- RFC: `docs/rfc/0002-agent-preview-environments.md` (the rungs below this decision)

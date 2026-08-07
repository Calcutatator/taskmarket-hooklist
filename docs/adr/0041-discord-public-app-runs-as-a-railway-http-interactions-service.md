# 0041 — Discord public app runs as a Railway HTTP Interactions service

> **Decision (Y-statement):** In the context of adding a public Discord companion to Taskmarket,
> facing a read-only request/response workload and a strict need to isolate community automation
> from market writes and agent-control credentials, we decided to run a separate stateless Node
> HTTP Interactions service on Railway to achieve one deployment and promotion model with a small
> permission surface, accepting another Railway service and explicit command-registration
> operations.

- **Status:** Accepted
- **Date:** 2026-08-05
- **Embodiment:** Verified
- **Last audited:** 2026-08-05
- **Author:** Codex, drafting the human-directed Railway decision
- **Reviewers:** Codex — self-attested; no independent reviewer recorded
- **Deciders:** Human workspace owner — approved Railway in conversation on 2026-08-05
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** —
- **Pending Amends / Amended-by:** —

## Context

Taskmarket needs a public Discord experience for onboarding, support, developer discussion,
showcases, events, and safe links back to canonical product surfaces. Discord must not become a
second task ledger: Taskmarket remains authoritative for task visibility, submissions, payments,
disputes, identity, and reputation.

The first application workload is request/response only. Slash commands look up explicitly public
Taskmarket data or return curated documentation, status, and support links. It does not require
ordinary message events, presence, member events, a persistent Discord Gateway session, privileged
intents, or application-owned storage.

Taskmarket already promotes backend, web, and docs services through Railway DEVNET after successful
CI on `main`, then promotes a CI-passed `v*` tag to Railway PRODUCTION. The Discord service should
follow that release ladder while keeping separate application credentials and a separate failure
boundary from the backend.

RFC-0003 describes a possible Discord-triggered development-agent control plane. That system would
hold materially stronger GitHub, model-provider, and execution permissions. It is not the public
community application and must never share its Discord application, token, process, or Railway
service.

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| Separate stateless Node HTTP Interactions service on Railway | Reuses the existing DEVNET/PRODUCTION promotion model; conventional Node runtime; no Gateway or privileged intents; isolated deploy and credentials | Adds a Railway service, public endpoint, health checks, command registration, and rollback operations |
| Cloudflare HTTP Interactions Worker (rejected) | Small stateless blast radius; natural edge request model; aligns with existing email and OG Workers | Creates a second deployment platform and promotion workflow for the public app after the human selected Railway |
| Embed Discord interactions in the existing backend (rejected) | No new service; can call backend internals directly | Couples community availability and secrets to the financial/task backend; broadens the backend's public attack surface and failure domain |
| Long-lived Discord Gateway bot on Railway (deferred) | Supports message, member, presence, and moderation events | Adds reconnect/session state and stronger intents that the v1 command set does not need |

## Decision

The public Discord application runs as `apps/discord-app`, a separate stateless Node HTTP service on
Railway. It exposes `POST /interactions` and `GET /health`, verifies every Discord signature and
timestamp against the raw request body, and calls only known public Taskmarket API routes through a
typed client.

The v1 service does not connect to the Discord Gateway, request privileged intents, store member or
message data, connect directly to the Taskmarket database, or receive wallet, X402, backend-admin,
GitHub, model-provider, or contract-deployer credentials. It has no Taskmarket write commands.

DEVNET and PRODUCTION use separate Discord applications, guild configuration, credentials, and
Railway service variables. Successful CI on `main` deploys the exact commit to the DEVNET service.
A CI-passed `v*` tag deploys the same commit to PRODUCTION. Command registration is an explicit,
serialized operation, not a process-boot side effect. Railway health checks verify the exact
commit; Discord's endpoint validation verifies signed PING handling, followed by live command
canaries in the target guild.

The public service and the RFC-0003 agent-control plane are permanently separate trust domains. A
future requirement for Gateway events or agent control returns for its own ADR rather than quietly
expanding this service.

## Consequences

**Positive:**

- Discord community automation cannot directly invoke Taskmarket financial or task mutations.
- The service follows Taskmarket's existing Railway promotion boundary and exact-commit release
  model.
- A Discord outage or bad command deployment does not take down the Taskmarket backend.
- No Gateway connection, message-content access, member-event stream, or persistent bot state is
  required for v1.
- Separate DEVNET and PRODUCTION applications prevent test command and credential drift from
  crossing environments.

**Negative / trade-offs:**

- Railway gains another independently monitored, rolled-back, and billed service.
- Command schemas and application code have separate rollout state, requiring serialized
  registration and backwards-compatible rollback.
- Operators must own Discord credential rotation, staging guild checks, and an emergency command
  disable path.

**Neutral / follow-up:**

- Native Discord Community features remain the primary onboarding and moderation mechanism; the
  application does not recreate them.
- Durable outbound Task Drop announcements, wallet-backed profile verification, and support-ticket
  persistence each require separate decisions because they add state or stronger permissions.
- If Gateway events become necessary, a later ADR will decide whether to add a separate service or
  replace this interaction model.

## References

- [RFC-0003 — Agentic Development Factory](../rfc/0003-agentic-development-factory.md)
- [ADR-0002 — Merging to `main` automatically deploys app code to the shared testnet](0002-testnet-auto-deploys-on-merge-to-main.md)
- `.github/workflows/deploy-testnet.yml`
- `.github/workflows/deploy-production.yml`

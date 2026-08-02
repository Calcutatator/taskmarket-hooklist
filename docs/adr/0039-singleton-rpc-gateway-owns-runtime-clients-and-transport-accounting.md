# 0039 — Singleton RPC gateway owns runtime clients and transport accounting

> **Decision (Y-statement):** In the context of long-lived backend blockchain access, facing
> independently constructed clients, invisible provider retries, multicall amplification, and
> concurrent server-wallet nonce allocation, we decided to route runtime public and server-wallet
> RPC through one process singleton gateway and measure requests at viem's raw transport seam, to
> achieve exact bounded-cardinality provider accounting while preserving viem retry behavior and
> ADR-0019's nonce guarantees, accepting process-local client state and one structured telemetry
> event per physical provider attempt.

- **Status:** Proposed
- **Date:** 2026-08-02
- **Embodiment:** Verified
- **Last audited:** 2026-08-02
- **Author:** Codex (drafted for review)
- **Reviewers:** Codex — self-attested; no independent reviewer recorded
- **Deciders:** Pending human approval
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** —
- **Pending Amends / Amended-by:** —

## Context

Backend runtime chain access has historically been distributed across helpers that independently
construct viem public and wallet clients. This makes provider traffic difficult to attribute and
allows a supposedly logical request to conceal transport retries or multiple contract subcalls.
It also makes the lifetime of the server wallet's account and nonce manager implicit.

The draft RPC efficiency operating model in RFC-0007, published for review in PR #408, proposes a
Tier 0 gateway before any load-reducing behavior changes. Issue #392 scopes that tier: centralize
runtime client ownership and record every physical provider attempt without changing application
functionality, viem's retry behavior, or the wallet safety established by ADR-0019.

The measurement boundary matters. Instrumenting service helpers misses viem transport retries.
Instrumenting only completed actions collapses several provider requests into one. Conversely,
reimplementing viem's retry or multicall behavior to make it easier to count would couple
observability to provider behavior and could introduce correctness regressions. Telemetry must
also avoid high-cardinality or sensitive values such as addresses, task IDs, transaction hashes,
calldata, raw errors, RPC URLs, and credentials.

The implementation associated with this proposal is a reviewable prototype on a draft PR. It
must not merge until a human Decider accepts this ADR and an independent reviewer acknowledges it.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| One process singleton gateway for runtime public and server-wallet clients, with instrumentation at viem's raw transport request seam (proposed) | Counts each physical attempt while retaining viem behavior; gives the nonce-managed account and clients an explicit process lifetime; supports bounded operation attribution and automatic Multicall3 subcall counting | State and telemetry counters are process-local; every provider attempt emits an event; standalone tools need explicit exemptions |
| Instrument each contract service helper and keep constructing clients independently (rejected) | Smaller local change; operation names are immediately available | Misses internal transport retries and unattributed calls; duplicates instrumentation; leaves client and nonce lifecycle fragmented |
| Replace viem retry and multicall behavior with application-owned implementations (rejected) | Attempts and logical subcalls would be directly visible to application code | Changes behavior in an observability milestone; risks divergent retry, batching, encoding, and error semantics; increases maintenance burden |
| Keep independent public and wallet gateways that happen to share configuration (rejected) | Separates read and write concerns | Duplicates transport state and weakens the single ownership boundary; makes the lifetime relationship between wallet client, account, and nonce manager less explicit |

## Decision

If accepted, all long-lived backend runtime RPC access will use one lazily initialized,
process-local gateway. The gateway owns one public client and one server wallet client constructed
from one account carrying viem's nonce manager. It preserves ADR-0019's nonce mechanism while
making its account and client lifetime explicit. Standalone smoke, deployment, and maintenance
processes may own clients only through a narrow, documented allowlist enforced structurally in
tests.

The gateway will wrap viem at the raw transport request seam inside viem's existing retry wrapper.
Each transport invocation will emit one sanitized event containing only the bounded operation,
bounded chain ID, JSON-RPC method, application retry attempt, transport retry attempt, duration,
normalized outcome and failure class, start and completion in-flight counts, cache and singleflight
outcomes, and logical subcall count. Tier 0 performs no caching or coalescing, so both outcome fields
are explicitly `not_applicable`; later mechanisms must extend those closed types rather than emit
free-form labels. Base mainnet and Base Sepolia retain their numeric chain IDs while any other
development chain maps to the bounded `other` label. Multicall
subcalls will be derived from the actual Multicall3 request calldata at that seam, so viem batch
splitting yields one event per real provider request and an exact subcall total without additional
provider requests. Application retry loops will set their attempt context explicitly; transport
retries remain owned by viem and are counted independently.

Telemetry failures must never affect provider results. Unattributed work remains visible under one
bounded fallback label. Telemetry never records provider URLs, request parameters, identifiers,
calldata, credentials, or raw error text.

Procedure attribution uses the finite set of deployed tRPC router paths rather than accepting a
product-supplied free-form label; malformed paths collapse to `procedure:unknown`. Background work
uses a closed operation union (`indexer` and `reconciliation`), while work outside either context
collapses to `runtime:unattributed`. More granular product-operation names such as
`indexer_main_logs` require an explicit type change and reviewed call-site attribution instead of
creating labels dynamically from request data.

## Consequences

**Positive:**

- Provider request volume, retry amplification, multicall density, latency, failures, and
  concurrency can be measured from one runtime boundary.
- Public and server-wallet clients are reused instead of reconstructed by runtime helpers.
- The nonce-managed server account has one explicit process lifetime, preserving and clarifying
  ADR-0019 rather than replacing its nonce mechanism.
- Later RFC-0007 milestones can use measured baselines without first changing user-visible
  behavior.

**Negative / trade-offs:**

- Counters and client instances are local to each backend process; fleet-wide views require log or
  metric aggregation.
- A structured event is produced per physical provider attempt, so the telemetry sink must be
  sampled or aggregated appropriately at scale.
- Automatic logical-subcall inference initially recognizes standard Multicall3 `aggregate3`
  requests; a future deployless or different batching protocol needs an explicit decoder.
- A singleton nonce manager cannot coordinate separate backend processes; this decision does not
  claim cross-replica nonce serialization.

**Neutral / follow-up:**

- This ADR does not approve the caching, coalescing, batching, retry-policy, or indexer-leadership
  changes proposed by RFC-0007. Those require their own accepted decisions when implemented.
- The associated implementation PR remains draft and merge-blocked until this ADR has a human
  Decider and independent reviewer acknowledgement and its status is changed to `Accepted`.
- Production RPC baselines and alert thresholds are follow-up work after the measurement boundary
  is accepted and deployed.

## References

- [ADR-0019 — Server wallet uses a nonce manager to serialize concurrent relayed calls](0019-server-wallet-nonce-manager-for-concurrent-relayed-calls.md)
- [RFC-0007 draft and implementation plan in PR #408](https://github.com/daydreamsai/taskmarket/pull/408)
- [Issue #392 — R01: Introduce a singleton backend RPC gateway and raw-transport instrumentation](https://github.com/daydreamsai/taskmarket/issues/392)

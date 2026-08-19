# 0092 — External x402 payments use a separate locally policy-gated client

> **Decision (Y-statement):** In the context of letting Taskmarket wallets buy resources from
> external x402 services, facing untrusted payment challenges, variable `upto` charges and the
> platform-specific behavior of Taskmarket's existing payment client, we decided to use the
> official x402 EVM client behind a local policy and spend-journal boundary that is separate from
> Taskmarket's internal x402 transport, to achieve protocol interoperability and bounded autonomous
> spending, accepting a second payment-client path and machine-local rather than account-wide
> enforcement.

- **Status:** Accepted
- **Date:** 2026-08-19
- **Accepted:** 2026-08-19
- **Embodiment:** Verified
- **Last audited:** 2026-08-19
- **Author:** Codex
- **Reviewers:** Codex — self-attested; no independent reviewer recorded
- **Deciders:** Oscar Mander-Jones — explicit approval in Conductor on 2026-08-19
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** —
- **Pending Amends / Amended-by:** —

## Context

The Taskmarket CLI already holds a normal secp256k1 EVM wallet and signs EIP-712 typed data, but its
`x402Post` transport is deliberately specific to Taskmarket. It prepends the Taskmarket API origin,
adds platform legal receipts and idempotency keys, assumes JSON POST requests, and understands the
platform's relayed-intent failure envelope. Pointing that transport at arbitrary origins would risk
leaking Taskmarket-only credentials and would still support only the EIP-3009 `exact` shape that
Taskmarket emits.

External services can advertise several payment options across EVM networks and token contracts.
The x402 v2 `upto` scheme is materially different from Taskmarket's current flow: it uses Permit2,
authorizes a maximum, lets the resource server settle a smaller actual amount, and can require a
one-time token approval. An autonomous client must evaluate the origin, method, scheme, network,
asset, recipient, authorization lifetime and amount before it exposes the wallet signer. It must
also reserve rolling spend atomically across concurrent processes and retain the full authorized
maximum when a paid response is lost.

The Taskmarket backend cannot enforce those limits under the current key-unlock design. Once the
CLI retrieves its device encryption key, it can construct the local wallet account and sign without
asking the backend about each payment. Making policy account-wide would therefore require a remote
signer or another custody redesign and would disclose every external purchase to Taskmarket.

The first product boundary is a direct HTTP buyer for humans and agents: x402 v2 `exact` and `upto`
on policy-allowed EVM networks and explicitly allowlisted ERC-20 contracts, using HTTPS GET or JSON
POST. Discovery, non-EVM signers, other x402 transports and batch settlement remain separate work.

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| **Separate official client with local policy and journal** (chosen) | Uses maintained scheme and extension implementations; isolates external credentials from Taskmarket headers; bounds both individual and rolling autonomous spend; preserves all existing internal payment behavior | Adds a second client path; limits apply to one CLI installation and can be bypassed by another signer for the same wallet |
| Migrate internal and external payments to one official client (rejected) | One protocol engine and dependency set | Couples the new feature to Taskmarket legal receipts, idempotency and pending-intent migration; expands regression scope before external buying has proved itself |
| Extend the hand-written Taskmarket client (rejected) | Avoids new runtime dependencies and initially reuses familiar code | Creates a local fork of Permit2, `upto`, approval-extension and settlement-response behavior that must track a fast-moving public protocol |
| Enforce policy in the Taskmarket backend (rejected) | Can coordinate budgets across devices and resist local policy-file deletion | Requires a custody/signing redesign, makes external buying depend on Taskmarket availability, and exposes third-party purchase metadata to the platform |
| Check only a per-payment maximum (rejected) | Small implementation and no persistent journal | Concurrent or repeated individually valid requests can drain the wallet; unsafe for unattended agents |

## Decision

External payments use pinned, mutually compatible releases of the official `@x402/core`,
`@x402/evm` and `@x402/fetch` packages. A new external-payment adapter registers the official EVM
`exact` and `upto` schemes against the existing locally decrypted viem account. The existing
Taskmarket `x402Post` implementation and every command that calls it remain unchanged.

The signer is exposed to the official client only after a local, versioned policy has accepted the
canonical HTTPS origin and path, HTTP method, x402 version, scheme, CAIP-2 network, token contract,
recipient, authorization lifetime and maximum atomic amount. Unknown assets are denied. Persistent
rules authorize unattended operation; an interactive user may approve one payment as an exception
without mutating policy. Command-line options may narrow but never widen a persistent unattended
rule.

Before signing, an append-only local journal atomically reserves the complete `exact` amount or
`upto` ceiling against the matching rolling window. A confirmed `upto` settlement replaces the
reservation with its actual charge. Once the payment-bearing request is dispatched, missing or
ambiguous settlement evidence leaves the maximum reserved and forbids automatic retry until chain
reconciliation or an explicitly audited manual resolution establishes an outcome.

Permit2 allowance is part of the same policy boundary. The client uses official gas-sponsored
approval extensions when the challenge supports them and policy permits them. Otherwise it may
submit a direct ERC-20 approval through a policy-configured RPC after verifying chain ID, native
balance and a gas ceiling. Automatic approval is bounded by the rule's token spending window and
never grants an unlimited allowance by default.

The policy and journal live under `~/.taskmarket/` with owner-only permissions. Enforcement is a
safety control for agents using this CLI installation, not an on-chain wallet invariant and not an
account-wide Taskmarket guarantee.

## Consequences

**Positive:**

- Taskmarket wallets can pay compatible third-party EVM x402 services without exporting a private
  key.
- Humans receive explicit terms while unattended agents operate only inside durable origin, asset
  and rolling-spend rules.
- Official implementations own the security-sensitive EIP-3009, Permit2, `upto` and approval
  extension wire formats.
- Existing Taskmarket payments keep their tested legal, idempotency and recovery behavior.
- Lost paid responses consume budget conservatively instead of triggering a second payment.

**Negative / trade-offs:**

- The CLI carries separate internal and external x402 client paths.
- Local policy and accounting do not coordinate across machines or other wallet software.
- Direct Permit2 setup can require native gas and a configured RPC for each network.
- `upto` still requires trust in the seller's usage calculation; a conforming seller may charge the
  complete maximum the client authorized.
- External x402 protocol releases need deliberate dependency updates and conformance regression
  testing.

**Neutral / follow-up:**

- Search and Bazaar discovery can later feed URLs into the same policy-gated request command; they
  do not weaken or bypass policy.
- A future account-wide policy service requires a separate custody ADR.
- Migrating Taskmarket's internal paid commands to the official client is separate work.
- Non-EVM signers, MCP/A2A transports and batch settlement require their own product scope.

## References

- [x402 v2 specification](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md)
- [x402 `upto` scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/upto/scheme_upto.md)
- [x402 EVM `upto` scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/upto/scheme_upto_evm.md)
- `apps/cli/src/lib/x402.ts`
- `apps/cli/src/lib/signer.ts`
- `apps/cli/src/lib/keystore.ts`
- `apps/cli/src/lib/external-x402-client.ts`
- `apps/cli/src/lib/x402-policy.ts`
- `apps/cli/src/lib/x402-journal.ts`
- `apps/cli/src/lib/x402-permit2.ts`
- `apps/cli/test/unit/external-x402-client.test.ts`
- `apps/cli/scripts/smoke-external-x402.ts`

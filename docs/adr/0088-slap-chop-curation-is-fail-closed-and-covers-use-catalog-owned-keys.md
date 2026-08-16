# 0088 — Slap-Chop curation is fail-closed and covers use catalog-owned keys

> **Decision (Y-statement):** In the context of manually publishing immutable Taskmarket games,
> facing the need for a simple recoverable curator bootstrap and cover retention independent from
> task artifacts, we decided to authorize curators with a server-side Privy-user environment
> allowlist and store curator-supplied covers as immutable content-addressed objects under a
> catalog-owned prefix in the existing storage backend, to achieve a small fail-closed control
> plane with auditable assets, accepting deploy-owner involvement for curator changes and no
> self-service role administration in the MVP.

- **Status:** Accepted
- **Date:** 2026-08-16
- **Accepted:** 2026-08-16
- **Embodiment:** Verified
- **Last audited:** 2026-08-16
- **Author:** Codex
- **Reviewers:** Codex — self-attested; no independent reviewer recorded
- **Deciders:** Oscar Mander-Jones — explicit approval in Conductor on 2026-08-16
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** —
- **Pending Amends / Amended-by:** —

## Context

The MVP needs a private publishing workflow but does not need a general administration product.
Curator authority must not be inferred from client state or wallet ownership, and losing access to
one curator account must have a documented recovery path. Adding database-managed roles would
require a privileged role-management API and a bootstrap mechanism for that API before the first
game could be published.

Cover images have a different lifecycle from Taskmarket submission artifacts. An eligible image
artifact can remain pinned to its original task, but a curator may need to supply catalog artwork.
Storing such artwork as though it belonged to a worker submission would misrepresent provenance;
using a separate bucket would duplicate credentials, local-storage behavior and operational setup.

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| **Privy-user environment allowlist plus catalog-owned content-addressed keys in the existing storage backend** (chosen) | Small surface; server-authoritative and fail-closed; reuses storage operations while keeping provenance and retention distinct | Curator changes require a configuration update and redeploy; no self-service role UI |
| Database-managed curator roles and admin endpoints (deferred) | Changes do not require deployment; supports richer roles and audit | Needs a secure bootstrap/recovery authority and substantially expands the MVP administration surface |
| Wallet-address allowlist (rejected) | Familiar Taskmarket identity shape | Forces a wallet into a non-economic operator flow and diverges from the selected Privy identity model |
| Store curator covers as Taskmarket submission artifacts (rejected) | Reuses existing artifact paths directly | Falsely attributes catalog-owned media to a submission and couples cover retention to task artifacts |
| Use a second bucket for catalog covers (rejected for MVP) | Strong physical separation | Duplicates credentials, provisioning, local emulation and lifecycle operations without adding a necessary trust boundary |

## Decision

The backend reads curator identities from `SLAP_CHOP_CURATOR_PRIVY_USER_IDS`, a comma-separated set
of exact Privy user IDs. Configuration parsing trims and de-duplicates entries, rejects malformed
values and treats an absent or empty set as no authorized curators. Every curator request verifies
the Privy access token server-side and compares its `user_id` with the parsed set. Client claims,
email addresses and wallet addresses do not grant curator authority.

Adding, removing or recovering a curator requires an authorized Taskmarket deploy owner to update
the backend's Railway environment and redeploy. Removing an ID revokes new requests after the
replacement deployment; existing short-lived Privy tokens do not bypass the server-side list.
Every draft, publish, hide and re-publish mutation records the verified curator ID and before/after
metadata in the curation audit table.

An eligible Taskmarket image artifact may be referenced directly as a cover with its source IDs and
hash. A curator-supplied cover instead uses the existing backend storage abstraction under
`slap-chop-games/covers/sha256/<digest>.<ext>`. The server verifies supported media type, dimensions,
square aspect ratio, fetched byte count and digest before publication. Keys are immutable and never
overwritten; the game row stores the key, digest, media type and dimensions. Deletion is allowed
only through a later retention process that proves no current or audit reference still needs the
object.

## Consequences

**Positive:**

- Curator authorization has one reviewable server-side source and fails closed when unconfigured.
- Recovery uses the repository's existing deployment authority rather than creating an initial
  super-admin account.
- Catalog-owned covers remain distinguishable from worker-produced artifacts while reusing storage
  credentials and local behavior.
- Content-addressed keys prevent silent image replacement and make cache behavior deterministic.

**Negative / trade-offs:**

- Routine curator membership changes require a deployment configuration change.
- A compromised deploy owner can change the curator set, so deployment access remains a privileged
  trust boundary.
- Immutable cover objects need a deliberate reference-aware cleanup job if storage growth matters.

**Neutral / follow-up:**

- Move to database-managed roles only with a separate decision covering bootstrap, recovery and
  role-change audit.
- Automatic cover generation remains outside the MVP.

## References

- [RFC 0009 — Slap-Chop Games catalog](../rfc/0009-slap-chop-games-catalog.md)
- [Wayfinder M0 #554](https://github.com/daydreamsai/taskmarket/issues/554)
- `apps/backend/src/lib/storage.ts`
- `apps/backend/src/lib/privy-auth.ts`

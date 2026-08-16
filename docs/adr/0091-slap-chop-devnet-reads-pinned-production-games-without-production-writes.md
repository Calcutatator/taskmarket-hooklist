# 0091 — Slap-Chop DEVNET reads pinned production games without production writes

> **Decision (Y-statement):** In the context of validating Slap-Chop against representative games
> when DEVNET has too few accepted HTML artifacts, facing both production-write risk and storage
> CORS restrictions, we decided to give non-production builds an exact, read-only allowlist of
> production artifact pins served through a same-origin integrity-verifying proxy, to achieve
> production-real catalog and sandbox acceptance without sharing mutable state, accepting a small
> manually reviewed manifest until the production catalog itself can become the read source.

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
- **Amends / Amended-by:** Amends ADR-0087
- **Pending Amends / Amended-by:** —

## Context

The Slap-Chop runtime and catalog were built against deterministic fixtures and an isolated
environment backend. DEVNET, however, has too few completed public game tasks to represent the
catalog or exercise the runtime against the sizes and implementation styles users will encounter.
Production has suitable accepted HTML artifacts, including both a small arcade game and a game near
the runtime's upper size boundary.

Changing the application's single Taskmarket API origin to production is not an acceptable answer.
That origin also owns voting and curation, so a configuration intended for reads could make a later
client mutation alter production. Production storage currently grants browser CORS to the main
Taskmarket site but not localhost, ephemeral previews or the Slap-Chop hostname. Copying game bytes
into fixtures would avoid CORS but break the one-to-one provenance and freshness this validation
mode exists to test.

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| **Exact production pins with a read-only same-origin proxy** (chosen) | Uses accepted production bytes; production writes are structurally absent; works on localhost and changing preview hosts; preserves hash verification | Adds a reviewed manifest and server bandwidth; catalog votes are intentionally unavailable in this mode |
| Point the entire DEVNET app at the production backend (rejected) | Minimal configuration | Couples reads and writes; a vote or curator action can mutate production; production catalog routes may not yet be deployed |
| Copy production HTML into DEVNET fixtures (rejected) | Fully deterministic and offline | Duplicates artifacts, drifts from production provenance and does not test signed delivery behavior |
| Expand storage CORS and use arbitrary production task URLs (rejected) | Avoids proxy bandwidth | Preview origins are dynamic; creates a broad source surface; does not separate production mutations |

## Decision

`SLAP_CHOP_DATA_MODE=live-readonly` is allowed only in local, preview and DEVNET environments and
requires an explicit `SLAP_CHOP_LIVE_SOURCE_API_URL`. Production rejects that mode during environment
validation. The normal Taskmarket API origin remains the isolated environment backend, so existing
write routes never acquire a production destination.

The live catalog contains a small checked-in allowlist. Each entry pins its production task,
accepted submission, artifact, awarded worker, file identity, role, byte size, SHA-256 and
Keccak-256, plus the approved artifact delivery host. Reads re-resolve public production metadata
and fail the entry closed if the task is no longer completed and public, the primary awarded worker
is different, accepted-submission provenance is ambiguous, the artifact metadata drifts, the
delivery host changes or a fresh delivery URL is unavailable.

The browser receives an app-origin artifact URL, never the production storage URL. That exact-slug
route fetches no arbitrary URL, enforces the shared HTML size limit, verifies the downloaded byte
length and SHA-256, and serves the bytes as an attachment with `nosniff`. The existing browser
runtime then verifies the pin again. Its trusted wrapper reconstructs the verified bytes into a blob
URL, avoiding browser data-URL length limits while retaining a blob-only frame policy and an
opaque-origin game iframe. The game executes under the existing nested sandbox. Voting is
not rendered in live-readonly mode; curator identity is unconfigured and remains fail closed.

Fixtures remain the deterministic CI source, and isolated environment mode remains the mutation and
persistence test source. Once the production Slap-Chop catalog API is deployed and seeded, its
catalog-specific DTOs may replace the temporary task-resolution manifest without weakening the
read-only origin split or same-origin artifact delivery boundary.

## Consequences

**Positive:**

- DEVNET and local review exercise exact accepted production HTML across realistic byte sizes.
- No production bearer, vote or curator mutation path exists in the live-content configuration.
- One same-origin proxy works for localhost, Railway DEVNET and ephemeral preview domains without a
  broad storage CORS allowlist.
- Both the proxy and browser runtime enforce immutable source integrity.

**Negative / trade-offs:**

- Production artifact delivery temporarily consumes Slap-Chop server bandwidth.
- A production API or storage outage can omit pinned entries or make the live catalog unavailable.
- Adding or changing a game requires deliberate review and a manifest update.

**Neutral / follow-up:**

- Live-readonly is product and runtime acceptance, not vote, curation or persistence acceptance.
- The manifest must stay small and must never become a general public task proxy.

## References

- [ADR-0087 — Separate app over immutable Taskmarket artifacts](0087-slap-chop-is-a-separate-app-over-immutable-taskmarket-artifacts.md)
- [RFC 0009 — Slap-Chop Games catalog](../rfc/0009-slap-chop-games-catalog.md)
- `apps/slap-chop-games/lib/live-catalog.ts`
- `.github/workflows/deploy-testnet.yml`

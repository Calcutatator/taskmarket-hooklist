# 0087 — Slap-Chop Games is a separate app over immutable Taskmarket artifacts

> **Decision (Y-statement):** In the context of turning accepted Taskmarket HTML games into a
> consumer catalog, facing the need to preserve provenance and one browser-security policy without
> carrying marketplace chrome into the experience, we decided to deploy Slap-Chop Games as a
> separate Next.js application and Railway service at `games.taskmarket.dev`, backed by the existing
> Taskmarket backend and exact artifact pins executed through a shared sandbox package, to achieve
> independent product iteration with verifiable source integrity, accepting another deployable
> service and cross-application package boundary.

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
- **Amends / Amended-by:** Amended by ADR-0091
- **Pending Amends / Amended-by:** —

## Context

Taskmarket already stores accepted interactive HTML artifacts and previews them under a restrictive
iframe policy. A catalog needs a much smaller public experience: discover, search, play, return and
vote. Making a catalog entry point only at a task, however, would leave the playable submission and
artifact mutable as new submissions arrive or resolution rules change. Copying selected HTML into a
second product would break the provenance chain and create a second retention and security system.

The catalog also needs to deploy and evolve independently from the marketplace. The repository's
existing production, devnet and preview applications are deployed as separate Railway services,
while sharing packages and the backend. That pattern gives the new surface an operational owner
without requiring a separate repository or database.

## Considered options

| Option | Pros | Cons |
| --- | --- | --- |
| **Separate app and Railway service over immutable Taskmarket artifact pins, with one shared sandbox** (chosen) | Preserves provenance; keeps one backend and security policy; gives the catalog independent routing, deployment and visual ownership | Adds an application package, service, domain and CI/deployment surface |
| Add catalog and player routes to `apps/web` (rejected) | Lowest initial repository and deployment overhead | Couples the consumer product to marketplace providers, navigation and release cadence; makes the intentionally sparse shell harder to preserve |
| Create a separate repository and copy selected HTML (rejected) | Maximum organizational independence | Duplicates auth, storage and sandbox policy; copied bytes can drift from the accepted source; provenance and retention become harder to audit |
| Point catalog entries at a task and resolve the latest eligible artifact at read time (rejected) | Smallest catalog schema | A published game can change without curator review and historical hashes no longer identify what users executed |

## Decision

Create `apps/slap-chop-games` as `@taskmarket/slap-chop-games`. Production uses the dedicated
`@taskmarket/slap-chop-games` Railway service in the existing Taskmarket project and the canonical
hostname `games.taskmarket.dev`. The existing Taskmarket release/platform owners own its preview,
devnet, production and rollback workflows.

The application consumes catalog-specific contracts from the existing backend and PostgreSQL
database. A published game records an exact task ID, submission ID, HTML artifact ID, artifact hash
and the metadata needed to establish that the source was eligible when published. It never resolves
"latest" at play time and never edits the underlying Taskmarket artifact.

HTML bytes are fetched through short-lived storage URLs, checked against both declared and fetched
byte limits, hashed and compared with the curator-pinned digest before execution. The pure CSP,
document builder, iframe capability policy and typed runtime outcomes live in one shared package
used by both Taskmarket preview and Slap-Chop Games. The first release does not add same-origin,
forms, popups, navigation, pointer lock, workers, network, wallet or native-fullscreen capability.

## Consequences

**Positive:**

- The public product can remain visually and operationally independent without duplicating the
  marketplace's source of truth.
- A catalog record identifies the exact reviewed bytes, and execution fails closed on an integrity
  mismatch.
- Sandbox changes remain deliberate cross-application decisions with one implementation and test
  suite.
- Preview and production deployment can follow the repository's existing Railway service pattern.

**Negative / trade-offs:**

- CI, environment validation, preview cleanup and production deployment must account for another
  app and service.
- Shared sandbox changes can affect two products and therefore require compatibility coverage.
- A signed URL refresh or source outage can make a game temporarily unavailable even when its
  catalog metadata remains readable.

**Neutral / follow-up:**

- A later capability expansion requires a new decision; a game that needs a blocked capability is
  ineligible in the meantime.
- Service creation, DNS and rollback proof belong to the release milestone rather than this ADR.

## References

- [RFC 0009 — Slap-Chop Games catalog](../rfc/0009-slap-chop-games-catalog.md)
- [Wayfinder map #553](https://github.com/daydreamsai/taskmarket/issues/553)
- `apps/web/lib/sandboxed-html.ts`
- `.github/workflows/deploy-production.yml`
- `.github/workflows/deploy-preview.yml`

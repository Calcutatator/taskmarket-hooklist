# 0010 — Legal bundle changes are versioned by content digest and invalidate all prior acceptance

> **Decision (Y-statement):** In the context of a legal bundle (Terms, Privacy, Risks,
> Acceptable Use) that will change over time — first as counsel finalizes the draft, later as
> policy evolves — facing the question of how to know whether a user's past acceptance still
> covers the content currently in force, we decided to compute a deterministic SHA-256 digest
> over the full bundle (plus a hash per document) and require every acceptance and receipt to
> match the current bundle's version *and* digest exactly, invalidating all prior acceptances —
> without deleting their historical evidence rows — the moment either changes, to achieve
> certainty that no user is ever treated as having accepted content they were never shown,
> accepting that any edit to the checked-in documents, including a non-material typo fix,
> forces every existing accepter to reaccept.

- **Status:** Accepted
- **Date:** 2026-07-16
- **Embodiment:** Verified
- **Last audited:** 2026-07-29
- **Author:** Beau
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —

## Context

`packages/shared/src/legal.ts` defines the current legal bundle as markdown documents plus a
version string and effective date. `apps/backend/src/services/legal.ts` hashes each document
(`sha256:<hex>`) and the bundle as a whole (`bundleDigest`, a hash over the acceptance
statement, the per-document hashes, and the version string). `findAcceptance` and
`assertLegalAcceptanceAvailable` both require an exact match against the *current* bundle's
version and digest — an acceptance recorded against an older version or an edited-but-same-
version document no longer satisfies the gate, and `legal-access.ts` will require reacceptance.
Historical `legal_acceptances` rows are never deleted, only superseded as evidence.

This is a foundational assumption future legal/ops changes will be built against, and reversing
it later (e.g. to allow silent non-material edits) would mean re-auditing every acceptance
record's evidentiary validity, so it is recorded here rather than left implicit in the code.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Content-addressed digest; any change invalidates all prior acceptances (chosen) | Impossible to accidentally treat a stale acceptance as current; every accepted byte is cryptographically pinned to what the acceptance record claims was shown; audit trail is exact and self-verifying | A typo fix with no legal substance still forces every existing user to reaccept before their next protected action; requires batching edits deliberately to avoid needless reacceptance churn |
| Manual version bump only, no content hash check (rejected) | Lets an author fix a typo without forcing reacceptance | Depends entirely on the author remembering to bump the version for every materially significant change; a forgotten bump silently binds users to edited terms they never saw — precisely the failure this system exists to prevent |
| Effective-date-based versioning (a new version only takes effect at a future date; existing acceptances remain valid until then) (rejected) | Gives operators a grace period before newly edited terms bind existing users | Adds a second time axis (effective date vs. acceptance date) that every consumer of acceptance state has to reason about; does not itself answer "did this user see this exact content," it only delays when the question is asked |

## Decision

Keep the content-addressed digest model exactly as implemented: any change to bundle content
or version invalidates every prior acceptance for that subject, evidence rows are preserved
(never deleted) for audit purposes, and `docs/LEGAL_ACCEPTANCE.md`'s "Policy Updates" section
governs the operational practice of deploying documents and backend bundle together so this
doesn't fire on unintended drift between the two.

## Consequences

**Positive:**
- No acceptance can ever be silently stale — the digest check makes "did the user see exactly
  this content" a cryptographic fact rather than a manual audit.
- Historical acceptance evidence is retained, so past compliance posture remains provable even
  after a bundle changes.

**Negative / trade-offs:**
- Any edit to a legal document — including a non-substantive typo fix — forces full
  reacceptance across every existing user the next time `LEGAL_ENFORCEMENT_ENABLED` is on,
  since the digest changes regardless of whether the edit was material.
- This places real weight on the operational discipline called out in
  `docs/LEGAL_ACCEPTANCE.md`'s "Policy Updates" section (batch edits, don't edit active copy
  in place); there is no code-level distinction between a material and a cosmetic change.

**Neutral / follow-up:**
- `LEGAL_ENFORCEMENT_ENABLED` currently gates all of this off in production, so no reacceptance
  churn has happened yet; this decision matters starting the moment enforcement is switched on.

## References

- `docs/LEGAL_ACCEPTANCE.md` ("Policy Updates" section)
- `packages/shared/src/legal.ts`, `apps/backend/src/services/legal.ts`
- PR #165 — Add versioned legal acceptance across web, API, and CLI

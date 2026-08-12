# 0032 — Adopt RFC-lite for pre-decision proposals

> **Decision (Y-statement):** In the context of design proposals that lay out real alternatives and
> open questions but **no decision made yet** — the kind of material that currently lives in
> `docs/specs/` as an ad hoc "this is an RFC, not a decision record" disclaimer paragraph copy-pasted
> into each file — facing the problem that ADRs assume a decision has already been made (an ADR's
> Y-statement structurally requires "we decided..."), we decided to adopt a lightweight **RFC**
> artifact (Summary, Motivation, Proposal, Open questions, Non-goals, References; status
> `Draft → Discussion → Accepted | Rejected | Superseded`; unlinted; stored in `docs/rfc/`) to
> achieve a durable, versioned, indexed home for proposals that invite comment before a decision is
> made, accepting a second (unenforced) documentation convention to maintain alongside ADRs.

- **Status:** Accepted
- **Date:** 2026-07-28
- **Accepted:** 2026-07-29
- **Embodiment:** Verified
- **Last audited:** 2026-07-28
- **Author:** Beau
- **Reviewers:** Beau — self-attested; no independent reviewer recorded
- **Deciders:** Beau
- **Supersedes / Superseded-by:** —

## Context

`docs/adr/README.md` already draws a line between an ADR (a decision) and a design proposal (not
yet decided) — but the proposal side of that line has never had a real home. In practice, 4 of the
5 files in `docs/specs/` are proposals in spirit, not built specs: each opens with a hand-copied
disclaimer paragraph ("This is an RFC: a design proposal for discussion, not a decision record...
This document should not be read as already-approved") repeated verbatim across files rather than
established once as a real convention. There's no template, no numbering, no index, no status
lifecycle field, and no directory boundary separating "this is a proposal, not yet decided" from
"this is a spec for something actually being built."

The result: proposal documents and already-built specs sit in the same directory with the same
`.md` extension and no way to tell them apart except reading the first paragraph. A fifth file
(`erc8195-delegation-chains.md`) doesn't even carry the disclaimer or a status header, despite being
the same kind of pre-decision options analysis (a comparison table of approaches, an "Open
Questions" section) as the other four — it's simply never been retrofitted.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Reuse ADRs with `Status: Proposed` | No new convention; one lifecycle to learn | The Y-statement structurally demands "we decided..."; `Proposed` on an ADR already means something else (a decision pending review, not an open multi-option question); misuses the format |
| GitHub Discussions / issues only | Zero new tooling; native commenting UI | Not versioned alongside the code; hard to reference precisely from a spec or a later ADR (issues move, get closed/reopened, lack a stable path) |
| Keep the status quo — a disclaimer paragraph inside `docs/specs/` | Zero overhead, nothing to migrate | Exactly the problem this ADR exists to fix: no template, no index, no numbering, one file (`erc8195-delegation-chains.md`) doesn't even follow the informal convention consistently |
| **Adopt a lightweight RFC artifact in its own `docs/rfc/` directory (chosen)** | Durable, versioned, diff-able like ADRs; a real template + index instead of copy-pasted boilerplate; can spawn one or more ADRs once something is actually decided | A second convention to maintain alongside ADRs; unenforced (no linter) so it can drift in quality without one |

## Decision

Adopt **RFC-lite**, mirroring the ADR scaffolding already established in this repo (an ADR's own
format is itself a deliberate documentation decision, so applying the same rigor one stage earlier
in the lifecycle is consistent):

- **Location:** `docs/rfc/`, files named `NNNN-kebab-slug.md`, with a `docs/rfc/README.md` index
  (mirroring `docs/adr/README.md`) and a `docs/rfc/_template.md`.
- **Structure (no Y-statement — nothing has been decided yet):** Summary, Motivation, Proposal (may
  be tiered/sectioned for a large or multi-phase proposal), Open questions, Non-goals, References.
- **Status lifecycle:** `Draft` (seeking comment) → `Discussion` → `Accepted` (the proposal, or
  parts of it, get built — each build spawns its own ADR(s) recording *that* decision, or the
  material is absorbed directly into a spec) | `Rejected` | `Superseded` (a later RFC replaces it).
- **No linter.** Unlike `packages/adr/adr-lint.ts`'s blocking checks, RFCs are intentionally
  unenforced — they're proposals, not commitments, and current volume (5 documents) doesn't justify
  tooling. Revisit if RFC volume grows.
- **Relationship to ADRs:** an RFC never itself changes the codebase or the "decided" state of
  anything. When a piece of an RFC is actually decided and built, that decision gets its own ADR
  (which may reference the RFC in its Context), and the RFC's status moves toward
  `Accepted`/`Superseded` accordingly.
- **Migration:** all 5 existing `docs/specs/*.md` proposal-shaped files move into `docs/rfc/`,
  restructured onto the new template (tracked as a separate follow-up commit, not part of this
  ADR's own scope). `docs/specs/` is reserved going forward for specs describing what's actually
  been decided and built.

## Consequences

**Positive:**
- Proposals with real alternatives and open questions get a durable, versioned, referenceable home
  instead of a copy-pasted disclaimer paragraph — the same benefit an ADR gives a decision, one
  stage earlier.
- Clear separation of concerns: RFC = "here's a direction, argue with it"; ADR = "this was decided,
  here's why"; spec = "here's what's actually built." No format is asked to do a job it wasn't
  designed for.
- `erc8195-delegation-chains.md`'s inconsistency (missing the disclaimer/header the other 4 files
  informally established) gets resolved by giving it the same real template everything else now has,
  rather than staying an outlier.

**Negative / trade-offs:**
- A second convention alongside ADRs for contributors (and future agents) to learn.
- Unenforced, so RFC quality/structure can drift over time without a linter catching it — acceptable
  at the current document volume.

**Neutral / follow-up:**
- If RFC volume grows enough to justify it, consider a lightweight `spec-lint.ts`-adjacent check
  (required sections, valid status, README index presence — no Y-statement requirement).
- The actual migration of the 5 existing files is tracked separately from this ADR.

## References

- **Precedent:** this repo's own ADR format is itself a deliberate documentation decision — applying
  the same reasoning one stage earlier in the lifecycle.
- First RFCs: see `docs/rfc/README.md`'s index.

# Specs

This directory holds specs for taskmarket — executable specs for an implementation agent, where
"agent" means a person or an AI. A spec describes what's actually been decided and is being (or
has been) built, in enough detail that whoever picks it up can build directly from it without
needing to re-derive the design from a conversation.

## What is a spec?

A spec is **post-decision**. It describes something real: a system, an API surface, a schema, a
migration — the kind of detail an implementation agent needs to build correctly. This is the key
difference from the other two document types in this repo:

- **RFC** (`docs/rfc/`) — a pre-decision proposal, inviting comment. Nothing has been decided yet.
- **ADR** (`docs/adr/`) — records that a specific decision was made, and why. Terse, one decision
  per file.
- **Spec** (here) — describes what's actually being built, in enough detail to build it. Can be
  large, can span multiple sections, can reference the ADR(s) that decided it.

An RFC can spawn one or more ADRs once part of it is decided; a spec is what gets built from that
decision.

## Template — "Spec-lite"

Use `_template.md` as your starting point:

```
# <Title>

> Version: X.Y | Date: YYYY-MM-DD | Status: Draft|Ready|Superseded
> **Implements ADRs:** ADR-NNNN (optional — omit if not yet decided)
> Depends on: <other specs> | Feeds into: <other specs>   (optional, cross-spec refs)

## Purpose
## Design / Architecture
## Interfaces / Contracts
## Security & Privacy considerations   (optional — omit if genuinely not applicable)
## Testing & Verification
## Non-goals
## References
```

**`Implements ADRs:`** is the back-pointer that lets `packages/adr/adr-audit.ts` compute whether an
ADR's decision has actually been specified/built — add it once a spec exists for a decided ADR, so
the reconciliation script can pick it up (see `docs/adr/README.md`'s "Embodiment (realization
tracking)" section).

## Linting

`packages/adr/spec-lint.ts` enforces structure, mirroring `adr-lint.ts`'s blocking/warn-only split:

- **Blocking**: all required sections present (`Purpose`, `Design / Architecture`,
  `Interfaces / Contracts`, `Testing & Verification`, `Non-goals`, `References` — `Security &
  Privacy considerations` is optional, never required); when a `Status` field is present, it must
  be one of `Draft`/`Ready`/`Superseded`; when a `Date` field is present, it must be a valid
  `YYYY-MM-DD`. A missing `Status`/`Date` field is not itself flagged — only a present-but-invalid
  value is.
- **Warn-only**: a stated `**Implements ADRs:** ADR-NNNN` reference that doesn't resolve to a real
  ADR in `docs/adr/` (dangling reference).
- **Not checked**: filename/numbering convention — left unconstrained.

Run via `make lint-check specs`.

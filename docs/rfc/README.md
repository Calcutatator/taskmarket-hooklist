# Requests for Comment (RFCs)

This directory holds RFCs — proposals that lay out a direction, the alternatives, and the open
questions, **before** a decision has been made. See [ADR-0032](../adr/0032-adopt-rfc-lite-for-proposals.md)
for why this exists and how it differs from an ADR.

## What is an RFC?

An RFC is a **proposal inviting comment**. It documents a direction worth considering — with its
alternatives and open questions — so it can be argued with and referenced later, rather than being
lost in a conversation or a PR description. It does not itself decide anything or change the
codebase.

This is the key difference from an ADR: an **ADR** records a decision that has already been made
(its Y-statement literally says "we decided to..."). An RFC hasn't decided yet — that's the whole
point of writing one. When part of an RFC is actually built, that decision gets its own ADR (which
may reference the RFC), and the RFC's status moves toward `Accepted` or `Superseded`.

## Template

Use `_template.md` as your starting point:

```
# NNNN — <Title>

- **Status:** Draft
- **Date:** YYYY-MM-DD
- **Author:** (who drafted this RFC)
- **Supersedes / Superseded-by:** —

## Summary
## Motivation
## Proposal
## Open questions
## Non-goals
## References
```

## Status lifecycle

```
Draft → Discussion → Accepted   (built — spawns its own ADR(s), or is absorbed into a spec)
                    → Rejected  (declined after discussion)
                    → Superseded (replaced before acceptance — a broader or better proposal supersedes it)

Accepted → Superseded (replaced by a later RFC, cross-linked)
```

## No linter

Unlike ADRs (`packages/adr/adr-lint.ts`, enforced in CI), **RFCs are not linted**. They are
proposals, not commitments, and the current volume doesn't justify the tooling. Revisit if that
changes.

## Index

| RFC | Title | Status | Date |
|---|---|---|---|
| [0001](0001-task-workflows-delegation-chains.md) | ERC-8195 delegation chains — task workflow design options | Draft | — |
| [0002](0002-agent-preview-environments.md) | Agent preview environments | Draft | 2026-07-13 |
| [0003](0003-agentic-development-factory.md) | Agentic development factory | Draft | 2026-07-13 |
| [0004](0004-task-phase-field.md) | A `phase` field for deadline-passed/awaiting-closeout tasks | Accepted | 2026-07-23 |
| [0005](0005-task-visibility-and-submission-visibility.md) | Task visibility and submission visibility | Accepted | 2026-07-24 |

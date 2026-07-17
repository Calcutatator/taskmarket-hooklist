# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for Taskmarket — a lightweight
log of every significant technical decision: what was decided, what alternatives were
considered, and why.

## What is an ADR?

An ADR records one decision. It is not a design proposal — that's an RFC, filed in
`docs/specs/` (e.g. `docs/specs/agent-preview-environments-rfc.md`). An ADR documents *why* a
decision was made, written once the decision is settled, not during the exploration. Once
accepted, an ADR is append-only: if a decision is later reversed, a new ADR supersedes the old
one and both remain, cross-linked.

Write one when a decision is hard to reverse, affects more than one part of the system, or
would otherwise get re-litigated later because nobody wrote down why it was made this way.
Skip it for reversible, local, or obvious choices.

## Template

Use `_template.md` as your starting point. Each ADR follows **MADR-lite** structure:

```
# NNNN — <Title>

> **Decision (Y-statement):** In the context of <use case>, facing <concern>,
> we decided to <option> to achieve <quality>, accepting <downside>.

- **Status:** Proposed
- **Date:** YYYY-MM-DD
- **Deciders:** (human name)
- **Supersedes / Superseded-by:** —

## Context
## Considered options
## Decision
## Consequences
## References
```

## Status lifecycle

```
Proposed → Accepted
        ↶ Withdrawn  (author pulls back before acceptance)
        ↶ Rejected   (proposal declined after review)

Accepted → Superseded  (a later ADR replaces this decision)
        ↶ Deprecated   (decision no longer applies, no direct replacement)
```

**A human must explicitly approve an ADR before its status becomes `Accepted`.** An agent may
draft, propose, and argue for a decision, but may not self-approve one — this is the one
required human-in-the-loop checkpoint in the flow below; everything upstream of it (research,
drafting, prototyping) can happen without a human present.

## Agent workflow

This process is written to work with an agent operating mostly unattended in its own PR
preview environment, not just with humans:

1. A human writes (or approves) the spec — an RFC in `docs/specs/`, or just a clear task
   description — and hands it to the agent.
2. The agent works the task in its own PR, iterating against its own isolated preview
   environment (its own Anvil chain, its own Postgres, reachable at its own environment URL)
   without needing a human present for ordinary implementation decisions.
3. When the agent hits a decision that is hard to reverse or affects more than its own PR —
   the kind of thing this file says belongs in an ADR — it stops and drafts one with
   `Status: Proposed`, laying out the context and the considered options (including at least
   one rejected alternative), instead of picking one unilaterally and continuing.
4. A human reviews the draft ADR and either approves it (`Status: Accepted`, their name
   recorded under `Deciders`) or sends it back. The agent does not resume implementation work
   on that decision until this happens.
5. Once accepted, the agent continues working in the same PR environment against the now
   settled decision.

The boundary this creates: an agent has full autonomy over reversible, local implementation
choices inside its own environment, and zero autonomy over decisions that would need an ADR —
those always pause for a human.

## Index

- [0001 — Mainnet contract upgrades stay manual and developer-local](0001-mainnet-upgrades-stay-manual.md)
- [0002 — Merging to `main` automatically deploys app code to the shared testnet](0002-testnet-auto-deploys-on-merge-to-main.md)
- [0003 — Backend boot fails fast on indexer catch-up and task-award reconciliation](0003-backend-boot-fails-fast-on-indexer-and-award-reconciliation.md)
- [0004 — Split-payout settlement is a separate event-backed `task_awards` ledger table](0004-task-awards-event-backed-ledger-table.md)
- [0005 — Indexer main event stream blocks on a failed event instead of skipping it](0005-indexer-blocks-on-failed-event-instead-of-skipping.md)
- [0006 — `task_awards` is the sole post-completion source of truth; `claimedBy` is the sole pre-completion assignment field](0006-task-awards-single-source-of-truth.md)
- [0007 — Indexer status-transition handlers are guarded by valid prior state](0007-indexer-status-transitions-are-guarded-by-prior-state.md)
- [0008 — `task_awards` table creation and the `tasks.worker`/`tasks.rating` drop ship in two separate deploys](0008-task-awards-migration-ships-in-two-deploys.md)
- [0009 — Legal acceptance is enforced by an opaque bearer receipt checked by default-deny middleware](0009-legal-acceptance-opaque-receipt-default-deny-middleware.md)
- [0010 — Legal bundle changes are versioned by content digest and invalidate all prior acceptance](0010-legal-bundle-content-digest-invalidates-prior-acceptance.md)

## Linting

Structure is enforced by `docs/adr/lint.mjs`:

```bash
make adr-lint
# or, directly:
node docs/adr/lint.mjs
```

Blocking checks: filename format (`NNNN-kebab-slug.md`), valid `Status`, `Date: YYYY-MM-DD`,
all four required sections present, no duplicate ADR numbers, Y-statement structural keywords,
at least one rejected alternative in Considered options, supersession-link symmetry and
direction, no dangling `ADR-NNNN` cross-references. Warn-only (never fails the build): README
index completeness, and relevant source changes (contracts, backend, RFC specs) without a
corresponding ADR change.

The source-changed-without-an-ADR check only activates when the linter is given the changed
file list. CI passes it automatically on pull requests (via `ADR_LINT_BASE`, diffing against
the PR's base branch) and surfaces any warnings as annotations on the PR — visible, but never
a failing check. Locally: `ADR_LINT_BASE=origin/main make adr-lint`.

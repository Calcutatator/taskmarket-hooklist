# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for Taskmarket — a lightweight
log of every significant technical decision: what was decided, what alternatives were
considered, and why.

## What is an ADR?

An ADR records one decision. It is not a design proposal — that's an RFC, filed in
`docs/rfc/` (see `docs/rfc/README.md`; e.g. `docs/rfc/0002-agent-preview-environments.md`). An ADR documents _why_ a
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
- **Embodiment:** Not started
- **Last audited:** YYYY-MM-DD
- **Author:** (who drafted this ADR)
- **Reviewers:** (who gave it a lightweight technical ack)
- **Deciders:** (who held binding approval authority)
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** —
- **Pending Amends / Amended-by:** —

## Context
## Considered options
## Decision
## Consequences
## References
```

### Three roles: Author, Reviewers, Deciders

An ADR distinguishes three roles, each answering a different question:

- **Author** — who drafted it. Can be a human or an agent (see Agent workflow below).
- **Reviewers** — who technically vetted it. Deliberately lightweight: any peer comment,
  "+1", or "lgtm" is enough. If no independent reviewer exists yet, name the author and say so
  plainly (e.g. `Beau — self-attested; no independent reviewer recorded`) rather than leaving the
  field blank or inventing a reviewer who didn't actually look at it.
- **Deciders** — who held binding approval authority to move `Status` to `Accepted`. This is the
  pre-existing field; it hasn't moved, but it's now explicitly one of three roles instead of the
  only one.

**Why `Deciders` is blocking and `Reviewers` is only a warning:** an `Accepted` ADR with no
recorded decision authority is a governance gap — it means a binding decision has no one
answerable for it, which is exactly the kind of silent gap this file exists to prevent. The linter
(`packages/adr/`) therefore treats a blank or placeholder `Deciders` field on an `Accepted`
ADR as a blocking error.
A missing lightweight technical ack in `Reviewers` is a smaller issue — useful to flag, not worth
blocking a merge over — so it's warn-only, the same posture `Deciders` itself had before this
convention existed with zero enforcement at all.

The linter also nudges (warn-only, never blocking) when `Author` and `Deciders` — or `Author` and
`Reviewers` — name the same person: a "self-ack smell." On a small team this will fire often and
is not by itself something to fix; it's a visibility signal for growing teams, not a defect. If a
field is self-attested (see above), the linter's placeholder detector correctly still treats the
named person as real content, not a blank — self-attestation is honest disclosure, not a
placeholder.

Same field-wrapping convention as `Supersedes / Superseded-by`: a value can wrap across multiple
lines with an indented continuation (see e.g. ADR 0004's `Deciders` field), and the linter reads
the whole thing, not just the first line.

### Pending supersession claims

`**Supersedes / Superseded-by:**` is a _binding_ claim — the linter enforces that both sides
of the relationship reference each other in this same field, with opposite directions
("Supersedes" on one side, "Superseded by" on the other).

That binding enforcement only makes sense once the claiming ADR is itself `Accepted`. An
`Accepted` ADR's binding relationships shouldn't silently change meaning just because someone
opens an unrelated, still-`Proposed` ADR against the same topic. So a not-yet-`Accepted` ADR
that wants to claim a supersession relationship records it in
`**Pending Supersedes / Superseded-by:**` instead — the linter checks it too, but the check is
a warning, not a blocking error, and it looks for reciprocation in the peer's own `Pending`
field rather than its binding one.

Once the claiming ADR is accepted, move the reference from `Pending Supersedes /
Superseded-by:` into the binding `Supersedes / Superseded-by:` field (on both sides of the
relationship) as part of the same review that flips `Status` to `Accepted`. Leaving it in
`Pending` after acceptance means the relationship is no longer enforced strictly.

### Amends / Amended-by

A distinct relationship from `Supersedes / Superseded-by`: use it when an ADR refines or
extends a peer ADR's decision without replacing it outright. The linter checks its symmetry
and direction the same way as `Supersedes / Superseded-by`, but entirely independently — a
claim in the `Amends` field is never satisfied by an entry in the `Supersedes` field, or vice
versa, since the two relations mean different things. The same not-yet-Accepted rule applies:
a still-`Proposed` ADR's amendment claim goes in `Pending Amends / Amended-by:` instead of the
binding field, promoted once the claiming ADR reaches `Accepted`.

Most ADRs never need this field at all; only fill it in when this ADR genuinely amends another.

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

`adr-lint` enforces the shipping half of that: a changed file carrying an `Implements: ADR-NNNN`
back-pointer fails the lint while that ADR is still `Proposed`. Drafting is unaffected — adding or
editing a Proposed ADR on its own always passes, and tests are exempt because they carry
`Verifies:` rather than `Implements:`. What is blocked is landing the implementation before the
human checkpoint above has actually happened.

This exists because the rule was stated and then not honoured. ADR-0039 said in its own text that
the implementation "must not merge until a human Decider accepts this ADR"; PR #410 merged to
`main` anyway with the ADR still `Proposed` and no Decider recorded, because nothing checked. A
merge gate written inside the document being gated is a note, not a gate.

## Embodiment (realization tracking)

`Status` answers "has this been decided" (`Proposed → Accepted`). `Embodiment` is a separate,
parallel field answering "has this decision actually been built" — independent of `Status`, since
an ADR can sit `Accepted` for months with zero implementation, or describe behavior that was later
removed from the codebase without the ADR being updated to say so.

States:

- **Not started** — no spec, code, or test references this ADR yet.
- **Specified** — at least one spec file's header carries `**Implements ADRs:** ADR-NNNN`.
- **Implemented** — at least one code file's comment carries `Implements: ADR-NNNN`.
- **Verified** — at least one test file's comment carries `Verifies: ADR-NNNN`.
- **Drift detected** — alarm state: the ADR's *stated* Embodiment (its own header field) disagrees
  with what the reconciliation script *computes* from the back-pointers above.
- **Inactive** — for a negative-decision ADR (e.g. "we decided not to do X") where the absence of
  code was true from the start, by design — nothing was ever built.
- **Deprecated** — the decision *was* genuinely realized (code existed, ran, was reachable) but its
  realizing code has since been intentionally removed or replaced, so no back-pointer can ever
  resolve again — distinct from `Inactive`, which never had realizing code to begin with. Always a
  stated value (like `Inactive`, the audit trusts it once declared rather than trying to compute
  it); typically paired with `Status: Superseded` and a dated follow-up note explaining what
  replaced it.

`pnpm --filter @taskmarket/adr run adr-audit` (warn-only, never blocks) walks `docs/specs/`,
`apps/`, and `packages/` (including this repo's own tooling — it's part of the architecture too)
for these back-pointer patterns, computes each ADR's embodiment,
and reports drift where stated and computed disagree. CI posts a compact summary as a PR comment —
total ADR count, drift count, a table of only the drifting ADRs, and the full per-ADR table folded
into a collapsed toggle — updating the same comment on subsequent pushes rather than stacking a new
one every time.

**Adding a back-pointer:** when a spec, code module, or test actually realizes an ADR, add the
corresponding marker so the audit picks it up:

```md
<!-- spec header -->
**Implements ADRs:** ADR-0042
```

```ts
// Implements: ADR-0042
```

```ts
// Verifies: ADR-0042
```

## Agent workflow

This process is written to work with an agent operating mostly unattended in its own PR
preview environment, not just with humans:

1. A human writes (or approves) the spec — an RFC in `docs/rfc/`, or just a clear task
   description — and hands it to the agent.
2. The agent works the task in its own PR, iterating against its own isolated preview
   environment (its own Anvil chain, its own Postgres, reachable at its own environment URL)
   without needing a human present for ordinary implementation decisions.
3. When the agent hits a decision that is hard to reverse or affects more than its own PR —
   the kind of thing this file says belongs in an ADR — it stops and drafts one with
   `Status: Proposed`, recording itself (or the person directing it) under `Author`, laying out
   the context and the considered options (including at least one rejected alternative), instead
   of picking one unilaterally and continuing.
4. A human reviews the draft ADR and either approves it (`Status: Accepted`, their name
   recorded under `Deciders`, with any technical ack recorded under `Reviewers`) or sends it
   back. The agent does not resume implementation work on that decision until this happens.
5. Once accepted, the agent continues working in the same PR environment against the now
   settled decision.

The boundary this creates: an agent has full autonomy over reversible, local implementation
choices inside its own environment, and zero autonomy over decisions that would need an ADR —
those always pause for a human.

## Index

The structured source of truth is `docs/adr/index.yaml` (see ADR-0033) — auto-generated by
`packages/adr/adr-audit.ts` on every run, never hand-edited. The list below is a rendered view
of that same file, spliced in between the markers on each audit run; the linter blocks a
push/CI run if this list (or `index.yaml` itself) has drifted from the real ADR corpus.

<!-- ADR-INDEX:START -- generated by packages/adr/adr-audit.ts; do not hand-edit between these markers -->
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
- [0011 — Diamond facet selectors get one shared source of truth, and upgrades become explicit versioned steps](0011-diamond-selectors-single-source-and-versioned-upgrades.md)
- [0014 — Task visibility stays public by default; unlisted and private are strictly opt-in](0014-task-visibility-public-by-default-opt-in.md)
- [0015 — Phase 1's `agents.inbox` gets a scoped self-auth check, not a general read-auth framework](0015-phase1-inbox-scoped-self-auth-not-general-framework.md)
- [0016 — Submission visibility is an independent axis from task visibility, defaulting to public and locked in at creation](0016-submission-visibility-independent-axis-default-public.md)
- [0017 — `bids.myBids` re-authenticates via signed self-auth message, not the device/API-token header](0017-bids-mybids-signed-self-auth-not-device-token.md)
- [0018 — `devices.register` requires a signature proving address ownership before minting a token](0018-devices-register-requires-signature-proof-of-address.md)
- [0019 — Server wallet uses a nonce manager to serialize concurrent relayed calls](0019-server-wallet-nonce-manager-for-concurrent-relayed-calls.md)
- [0020 — Normalizing wallet addresses](0020-normalize-wallet-addresses.md)
- [0021 — A task cancelled via a REJECT evaluator verdict counts as "ended" for submission-visibility reveal purposes](0021-cancelled-tasks-with-a-reject-verdict-count-as-ended-for-submission-reveal.md)
- [0022 — An agentId is permanently bound to the wallet address that registered it; no reassignment is supported](0022-agentid-permanently-bound-to-registering-wallet.md)
- [0023 — Converge `agents.inbox` and `bids.myBids` self-auth onto the general read-auth header](0023-converge-inbox-and-mybids-self-auth-onto-the-general-read-auth-header.md)
- [0024 — Add a derived `phase` field for the deadline-passed/awaiting-closeout task state](0024-task-phase-derived-lifecycle-field.md)
- [0025 — `updateTask` reward-increase gets a balance-sufficiency check, not a funding-model change](0025-update-task-reward-increase-funding.md)
- [0026 — refundExpired is callable by anyone, not just the requester](0026-refund-expired-is-permissionless.md)
- [0027 — Contest `pendingActions` suggest a worker address only when there is exactly one distinct submitter](0027-contest-pending-actions-suggest-worker-only-when-unambiguous.md)
- [0028 — Upgrading TaskTokenRewardHook reuses the existing RewardVault via a breaking hook cutover, after manually settling the one outstanding reservation first](0028-reward-hook-upgrade-leaves-old-hook-authorized-until-drained.md)
- [0029 — `processTaskCreatedEvent`'s reconciliation insert cannot recover off-chain-only `create()` inputs](0029-task-created-reconciliation-cannot-recover-off-chain-only-create-inputs.md)
- [0030 — Private tasks grant access via both wallet allowlist and password, discovered in-app via `agents.inbox`, using an opaque bearer receipt](0030-private-tasks-both-allowlist-and-password-in-app-invite.md)
- [0031 — Phase 3's private-task SSR gating is a client-side access gate, not a persisted wallet session](0031-private-task-ssr-gating-client-side-not-session.md)
- [0032 — Adopt RFC-lite for pre-decision proposals](0032-adopt-rfc-lite-for-proposals.md)
- [0033 — The ADR decision index is generated from a structured YAML source, not hand-maintained markdown](0033-structured-adr-index-generated-not-hand-maintained.md)
- [0034 — Per-PR preview environments: full redeploy per commit, disposable Anvil, self-provisioned facilitator](0034-per-pr-preview-environments-full-wipe-anvil-plus-self-provisioned-facilitator.md)
- [0035 — Submission metering bypasses x402Middleware entirely rather than pricing free submissions at zero](0035-submission-metering-bypasses-x402-not-price-at-zero.md)
- [0036 — Free-submission allowance is 5 per (worker, task)](0036-free-submission-allowance-is-five.md)
- [0037 — Tier 2 hard ceiling is 100 submissions per (worker, task) — NOT a platform-wide limit](0037-tier-2-hard-ceiling-is-100-submissions.md)
- [0038 — Rate limiting lives in one shared module, not bespoke per-feature logic — with two distinct check shapes, not one forced abstraction](0038-rate-limiting-is-a-shared-module-not-per-feature-bespoke-logic.md)
- [0039 — Singleton RPC gateway owns runtime clients and transport accounting](0039-singleton-rpc-gateway-owns-runtime-clients-and-transport-accounting.md)
- [0040 — Server-wallet transactions use a durable nonce allocator and outbox](0040-server-wallet-transactions-use-a-database-coordinated-dispatcher.md)
- [0045 — Relayed writes are durable intents, not request-scoped transactions](0045-relayed-writes-are-durable-intents-not-request-scoped-transactions.md)
- [0046 — Relayed intents chain follow-on writes rather than relaying inside handlers](0046-relayed-intents-chain-follow-on-writes.md)
- [0047 — Evaluator assignment is its own intent, and the chaining subsystem is withdrawn](0047-evaluator-assignment-is-its-own-intent-and-chaining-is-withdrawn.md)
- [0048 — Orphaning a payment is decided only by intent settlement; the ledger is retained](0048-orphaning-a-payment-is-decided-only-by-intent-settlement.md)
- [0049 — In-flight paid writes are observable through a dedicated intent-status surface, not `pendingActions`](0049-in-flight-paid-writes-are-observable-through-a-dedicated-intent-status-surface.md)
- [0050 — Durable writes follow the chain call, and an unbroadcast intent is retried before it is refunded](0050-durable-writes-follow-the-chain-call-and-unbroadcast-intents-are-retried-before-refund.md)
- [0051 — Replacement gas escalates geometrically under a configured, per-deployment cap](0051-replacement-gas-escalates-geometrically-under-a-configured-cap.md)
- [0053 — Relayed-write observability is by query, not by alerting](0053-relayed-write-observability-is-by-query-not-by-alerting.md)
<!-- ADR-INDEX:END -->

## Linting

Structure is enforced by the `@taskmarket/adr` package (`packages/adr/`) — a normal
workspace package, not code living inside this `docs/adr/` directory, so `docs/adr/` stays pure
ADR content and the linter is an ordinary `turbo test` / `turbo type-check` citizen like any other
package:

```bash
make lint-check adr
# or, directly:
pnpm --filter @taskmarket/adr exec tsx adr-lint.ts

# unit + corpus tests for the linter itself run as part of the normal test suite:
pnpm test
# or just this package:
pnpm --filter @taskmarket/adr test
```

Blocking checks: filename format (`NNNN-kebab-slug.md`), valid `Status`, `Date: YYYY-MM-DD`,
all four required sections present, no duplicate ADR numbers, Y-statement structural keywords,
at least one rejected alternative in Considered options, supersession-link symmetry and
direction for `Accepted`-lineage ADRs (see "Pending supersession claims" above), no dangling
`ADR-NNNN` cross-references, and an `Accepted` ADR must have a real (non-blank, non-placeholder)
`Deciders` value. Warn-only (never fails the build): README index completeness, relevant source
changes (contracts, backend, specs) without a corresponding ADR change, gaps in ADR
numbering, an `Accepted` ADR with a blank or placeholder `Reviewers` value, an `Author`/`Deciders`
or `Author`/`Reviewers` "self-ack smell" (same person named in both roles), and a still-`Proposed`
ADR's provisional supersession claim missing its `Pending Supersedes / Superseded-by:`
reciprocation on the peer side.

Placeholder detection strips leading wrapper punctuation (dashes, parens, brackets, underscores,
whitespace) off a field value and checks whether what's left _starts with_ a pending-style phrase
(`pending`, `tbd`, `awaiting`, `none`, `unknown`, `n/a`, …), case-insensitive. That correctly
catches both a bare placeholder (`(pending human approval)`) and one with leading punctuation
(`— (awaiting external ack)`), without misreading a field that has real partial content followed
by a separately-pending clause (e.g. `Original: Alice (approved 2026-01-01); later amendment:
awaiting ack` still counts as real content, because "Original: Alice..." doesn't itself start
with a pending phrase).

Gaps are warn-only, not blocking, on purpose: concurrent branches each drafting their own next
ADR number legitimately merge out of order (e.g. ADR 0022 shipping before 0021, which was
already drafted on a separate, still-open PR at the time) — blocking on a gap would force
serializing every ADR-touching PR or manually renumbering right before merge, which is exactly
the kind of easy-to-get-wrong manual step that caused the migrations-journal `task_drop_id`
incident this repo already learned from.

The source-changed-without-an-ADR check only activates when the linter is given the changed
file list. CI passes it automatically on pull requests (via `ADR_LINT_BASE`, diffing against
the PR's base branch) and surfaces any warnings as annotations on the PR — visible, but never
a failing check. Locally: `ADR_LINT_BASE=origin/main make lint-check adr`.

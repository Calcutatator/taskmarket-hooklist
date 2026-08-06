# 0041 — Action queues derive from canonical pending actions

> **Decision (Y-statement):** In the context of guiding every task participant to their next
> lifecycle obligation, facing fragmented task-detail controls and ambiguous notification counts,
> we decided to derive grouped action-queue intents from the server's canonical pending actions and
> count unresolved state rather than unread events, to achieve a self-healing, role-aware workflow
> without a second lifecycle source of truth, accepting that the queue cannot represent arbitrary
> informational notifications or user-managed read state.

- **Status:** Accepted
- **Date:** 2026-08-06
- **Embodiment:** Verified
- **Last audited:** 2026-08-06
- **Author:** Codex, drafting the approved Action Inbox architecture
- **Reviewers:** Codex — self-attested; no independent reviewer recorded
- **Deciders:** Oscar Mander-Jones — explicit approval in Conductor on 2026-08-06
- **Supersedes / Superseded-by:** —
- **Pending Supersedes / Superseded-by:** —
- **Amends / Amended-by:** —
- **Pending Amends / Amended-by:** —

## Context

Taskmarket's backend already computes role- and state-specific `pendingActions` for task detail
responses. Those actions account for task mode, status, deadlines, assignments, submissions, awards,
ratings, evaluator configuration, appeal windows, and dispute roles. The web application renders many
of them only after a user navigates into a task.

The existing `agents.inbox` response serves several different consumers as task history and private
task discovery. It does not compute pending actions, omits some lifecycle roles, and should not change
meaning underneath the Dashboard You view or CLI. The existing web Inbox also fetches that response
without consistently attaching read-auth headers and groups all returned tasks by raw status rather
than actual responsibility.

A header badge makes the ambiguity consequential. Counting raw pending actions overstates work because
several actions are mutually exclusive ways to resolve one obligation. Counting unread events allows a
user to clear an unfinished payout or review simply by opening the page. Reconstructing action rules in
React would create a second state machine that can drift from contract and backend behavior.

## Considered options

| Option | Pros | Cons |
|---|---|---|
| Additive server-derived grouped action queue (chosen) | Reuses canonical eligibility; self-heals as state changes; supports every role; preserves existing inbox consumers; no migration | Requires an explicit grouping taxonomy and batched projection query; arbitrary informational notices need another mechanism |
| Count raw `pendingActions` in each client (rejected) | Small initial backend change | Double-counts alternatives; duplicates lifecycle interpretation across web surfaces; invites auth and visibility drift; encourages N+1 task reads |
| Persist notification rows and read receipts (rejected for V1) | Supports arbitrary delivery, read state, and historical notifications | Creates a second lifecycle source of truth; requires write fan-out, reconciliation, cleanup, and migrations; "mark read" can hide unfinished obligations |
| Repurpose `agents.inbox` in place (rejected) | Avoids a new endpoint name | Breaks its history/private-discovery semantics for Dashboard You and CLI consumers and makes rollout coupling harder |

## Decision

Taskmarket will add an action-queue projection alongside `agents.inbox`. The server first computes the
same canonical pending actions used by task detail, then groups them into stable user-facing intents.
Each group carries its role, priority, deadline, underlying actions, and task context. Header totals,
Inbox rows, and task-detail invalidation all consume that projection through one shared web query seam.

An action group remains present until the underlying lifecycle state changes. Merely viewing it has no
effect. Waiting state is returned for explanation but excluded from totals. General marketplace
opportunities and optional task-management controls are excluded. Unsupported web actions are also
excluded until their complete, evidence-aware controls ship.

Public queue data may render without a signature. Private and unlisted actions are added only through
the existing read-auth mechanism after intentional wallet verification. Mounting the dashboard shell
must not trigger a surprise signature prompt.

Review, payout, evaluator, and dispute actions navigate to evidence-aware task surfaces rather than
executing from compact queue rows. Acceptance and rating remain separate explicit transactions. After
acceptance, the UI represents indexed settlement as confirming, invalidates both task and queue data,
and reveals rating automatically when canonical state permits it.

The existing unsafe `refundExpired` action is not surfaced by the queue until the repeat-refund
vulnerability is closed and terminal behavior is regression-tested.

## Consequences

**Positive:**

- Task lifecycle rules remain centralized in one server-side source of truth.
- Badge counts represent actual unfinished work and cannot be cleared accidentally.
- Existing `agents.inbox`, Dashboard You, CLI history, and private discovery contracts remain additive
  and compatible.
- Header, Inbox, and task detail share cache, authentication, refresh, and invalidation semantics.
- No notification table, read-receipt model, or database migration is required for V1.

**Negative / trade-offs:**

- Grouping raw actions into product intents becomes a maintained backend contract.
- The queue is intentionally unsuitable for arbitrary announcements or user-managed notification
  history.
- Eventual indexer consistency requires visible confirmation states and bounded polling after writes.
- Private totals may enrich after initial render instead of being complete before wallet verification.

**Neutral / follow-up:**

- External notification delivery and a desktop master-detail review workspace require separate product
  evidence and decisions.
- Evaluator/dispute intents are capability-gated until their web controls ship.
- Safe expired settlement remains a separate security-gated track.

## References

- [RFC-0008 — Action Inbox and guided task completion](../rfc/0008-action-inbox-and-guided-task-completion.md)
- [Wayfinder map: Action Inbox and guided task completion](https://github.com/daydreamsai/taskmarket/issues/473)
- [ADR-0023 — Converge inbox self-auth onto general read-auth headers](0023-converge-inbox-and-mybids-self-auth-onto-the-general-read-auth-header.md)
- [ADR-0024 — Derived task phase](0024-task-phase-derived-lifecycle-field.md)
- [ADR-0027 — Suggest a contest worker only when unambiguous](0027-contest-pending-actions-suggest-worker-only-when-unambiguous.md)
- [ADR-0030 — Private-task discovery through agents.inbox](0030-private-tasks-both-allowlist-and-password-in-app-invite.md)
- [Security: refundExpired is repeatable and drains pooled escrow](https://github.com/daydreamsai/taskmarket/issues/432)

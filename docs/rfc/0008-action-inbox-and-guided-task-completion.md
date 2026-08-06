# 0008 — Action Inbox and guided task completion

- **Status:** Accepted
- **Date:** 2026-08-06
- **Author:** Codex, synthesizing the product scope approved by Oscar Mander-Jones
- **Supersedes / Superseded-by:** —

## Summary

Taskmarket should provide a state-derived Action Inbox that guides each connected wallet from task
publication through review, settlement, evaluation, dispute handling, and rating. The Inbox should
count unresolved action groups rather than unread events, keep waiting tasks visible without making
them urgent, and direct users to the evidence needed before an irreversible action.

## Motivation

Taskmarket already derives canonical `pendingActions` on task detail responses, but users must find
those actions by reopening individual tasks. The existing `/dashboard/inbox` route is presented as
News, its task lists are closer to history than an action queue, and the dashboard shell provides no
indication that work is waiting. After a requester accepts work, indexed settlement and the separate
rating action can also require a manual refresh before the next step becomes apparent.

This fragmentation makes the protocol lifecycle correct but the product lifecycle difficult to
follow. Requesters are unsure what happens after posting, workers can miss assigned delivery work,
and evaluator or dispute actions may exist in the backend without an equivalent web control.

## Proposal

### Canonical projection

Add an authenticated, visibility-safe action-queue projection alongside the existing history-style
`agents.inbox` endpoint. The server continues to derive eligibility from canonical `pendingActions`,
then groups mutually exclusive raw actions into user-facing intents such as review work, select a
worker, submit assigned work, evaluate, appeal, resolve a dispute, or rate recipients.

The projection returns actionable groups, totals, priority, deadlines, role, and non-counting waiting
state. It batches the data required to derive actions and does not fetch task details once per result.

### Product surfaces

- `/dashboard/inbox` becomes a primary Inbox destination whose default view is "Needs your action";
  marketplace news remains a secondary tab.
- The dashboard header and sidebar show a compact action-group total and navigate to Inbox. They do
  not execute destructive actions or force a wallet signature prompt.
- After publication, persistent guidance tells the requester whether action is required now, what
  happens next, and that future review work will appear in Inbox.
- Review rows navigate to evidence before payment, rejection, evaluation, or dispute decisions.
- Acceptance, indexed settlement confirmation, and rating remain separate operations but form one
  continuous task-detail experience without requiring a manual refresh.
- Evaluator, appeal, finalization, and dispute intents enter the count only when their web controls
  are available.

### Count and priority semantics

The badge counts unresolved action groups, not raw action alternatives and not unseen events. Opening
Inbox does not clear an action. Completing the underlying lifecycle transition does. Waiting tasks are
shown separately and never increase the total.

Urgent actions with an elapsed or near deadline sort before required task-progress actions, which sort
before follow-up actions such as rating. Optional task management and general marketplace
opportunities to claim, bid, or pitch do not count.

### Safety and rollout

Private and unlisted tasks remain protected by the existing read-auth contract. Public results may
render without prompting; authenticated results are invalidated and enriched after intentional wallet
verification. V1 stores no notification/read-receipt rows and requires no database migration.

The `refundExpired` action remains suppressed until the separately tracked repeat-refund pooled-escrow
vulnerability is fixed and its terminal behavior is proven safe.

## Open questions

None for the first release. Production evidence may later justify a master-detail review workspace or
external delivery channels, but neither changes this proposal's state-derived action contract.

## Non-goals

- A general persisted notification center, read receipts, or "mark all read" behavior.
- Blind money-moving or verdict controls in the header or compact Inbox rows.
- Replacing marketplace activity, Dashboard You history, or the static "Your next move" panel.
- Email, push, or agent-callback notification delivery.
- Fixing the existing `refundExpired` contract vulnerability as part of the Action Inbox UI work.

## References

- [Wayfinder map: Action Inbox and guided task completion](https://github.com/daydreamsai/taskmarket/issues/473)
- [Security: refundExpired is repeatable and drains pooled escrow](https://github.com/daydreamsai/taskmarket/issues/432)
- [ADR-0023 — Converge inbox self-auth onto general read-auth headers](../adr/0023-converge-inbox-and-mybids-self-auth-onto-the-general-read-auth-header.md)
- [ADR-0024 — Derived task phase](../adr/0024-task-phase-derived-lifecycle-field.md)
- [ADR-0027 — Suggest a contest worker only when unambiguous](../adr/0027-contest-pending-actions-suggest-worker-only-when-unambiguous.md)
- [ADR-0030 — Private-task discovery through agents.inbox](../adr/0030-private-tasks-both-allowlist-and-password-in-app-invite.md)

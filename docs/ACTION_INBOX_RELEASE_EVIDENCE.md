# Action Inbox release evidence

## Release summary

The Dashboard Inbox is now an action workspace rather than a second copy of marketplace news. It
groups each task into one role-aware next-step intent, keeps waiting work out of the action badge,
and links into the relevant task section. The dashboard header and sidebar share the same canonical
count. After publication, requesters see durable waiting guidance; after acceptance, payout remains
in a confirmation state until settlement is indexed, and multi-recipient rating stays grouped.

Evaluator, appeal, timeout, finalization, and dispute controls include payment and settlement
confirmation copy. Evaluations require a non-zero evidence hash in the web flow. Evaluator and
resolver actions for restricted submissions remain excluded until ADR-0042 is explicitly accepted.
The repeatable `refundExpired` path remains excluded under security issue #432.

## Product evidence events

The web app emits the `taskmarket:action-inbox` custom event and matching Performance Timeline marks
for queue viewed, item opened, lifecycle action completed, and post-publication guidance seen. Events
carry an occurrence timestamp and only the fields needed to correlate an in-session task journey.
They do not add a tracking SDK, cookie, network request, or durable browser storage. They can measure
same-session queue-open-to-action and action-to-follow-up timings today. Submission-to-review and
other cross-wallet or cross-session timings remain unavailable until a separately approved,
consent-aware durable analytics adapter subscribes to these events.

## Stories reviewed

- `Product/Action Inbox`: disconnected, loading, error, empty, urgent, waiting, multi-rating,
  long-content, `99+`, dark, and mobile states.
- `Product/Task publication guidance`: mode-specific waiting, reduced-motion, and persisted guidance.
- `Patterns/Application shell`: connected and disconnected Inbox counts in the header and sidebar.
- `Product/Task actions`: settlement confirmation, evaluator evidence validation, irreversible-action
  confirmations, payout, and rating states.
- `Product/Task actions/Evaluator and dispute matrix`: evaluator verdict validation and confirmation,
  payment loading, reduced-motion submission, backend error recovery, worker appeal confirmation and
  expiry, requester evaluator timeout, permissionless finalization success and stale state, dark-theme
  dispute resolution, and disconnected decision-maker states.

## Routes reviewed

- `/dashboard/inbox`
- `/dashboard/tasks/:taskId?published=1`
- `/dashboard/tasks/:taskId?focus=review_work#task-activity`
- `/dashboard/tasks/:taskId?focus=rate_workers#settlement-payouts`
- `/dashboard/tasks/:taskId?focus=evaluate_work#task-activity`
- `/dashboard/tasks/:taskId?focus=appeal_verdict#task-verdict`
- `/dashboard/tasks/:taskId?focus=finalize_verdict#task-verdict`
- `/dashboard/tasks/:taskId?focus=resolve_dispute#task-activity`
- `/dashboard/tasks/:taskId#task-verdict` for evaluator timeout

## Validation

The release candidate is gated through the repository Makefile:

- `make test shared`
- `make test backend`
- `make test web`
- `make test storybook`
- `make build web`
- `make lint-check backend`
- `make lint-check web`
- `make format-check backend`
- `make format-check web`
- `make type-check backend`
- `make type-check web`
- `make lint-check adr`
- `make test adr`
- `make adr-audit`
- isolated-port `make ui-ci`

## Known release exclusions

- Production Playwright runs without Privy configuration, so real wallet signing and X402 payment
  are covered by component tests and Storybook interaction tests rather than synthetic injected
  browser wallets. Route-level Playwright covers publication, focused settlement/rating, disconnected
  count safety, and News preservation.
- Restricted evaluator and dispute-resolver evidence access is proposed in ADR-0042 and must not ship
  until a human accepts that visibility expansion. Public-submission evaluator controls and all
  permissionless or requester-owned evaluator transitions are covered now.
- Cross-wallet and cross-session submission-to-review timing is not measurable with the current
  memory-only event stream. Shipping a durable analytics sink requires separate consent and retention
  approval; release claims are limited to same-session interaction timing.
- `refundExpired` is intentionally absent from the queue pending the pooled-escrow security fix in
  issue #432.

## Follow-up evidence

Before considering a denser master-detail Inbox, collect consented production evidence on action
volume, item-open-to-completion time, repeated task-detail navigation, and rating abandonment. A
master-detail layout is justified only if users repeatedly move between several actionable tasks in
one session or task-detail round trips remain a dominant source of delay.

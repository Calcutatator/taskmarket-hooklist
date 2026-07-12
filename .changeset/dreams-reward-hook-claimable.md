---
"@lucid-agents/taskmarket": minor
---

Introduce DREAMS token rewards: workers and requesters now earn DREAMS tokens
on top of their USDC task payment, held as a claimable escrow balance you
withdraw on your own schedule with `taskmarket wallet withdraw-dreams
[--destination <addr>]`.

Reward size is set by two protocol rates: a bonus percentage of the task's
USD value, and a DREAMS/USDC exchange rate. Both are transparent everywhere
DREAMS amounts are shown: `taskmarket stats` (`pendingDreamsRewards`,
`pendingDreamsUsd`, `dreamsPerUsdc`), `taskmarket wallet withdraw-dreams`
output, `task get` (`estimatedWorkerDreamsBonus`,
`estimatedRequesterDreamsBonus`, and their USD equivalents), the publish
wizard, task detail, the submit-work flow, and a new account-page DREAMS
rewards card. New `GET /api/wallet/exchange-rate` endpoint exposes the
current rate, bonus percentage, and worker/requester split.

A wallet-age ramp reduces rewards for new wallets to limit Sybil farming,
and rewards split between worker and requester (80/20 by default).

See the [DREAMS Token Rewards](/reference/rewards) reference doc for the
full formula, caps, and withdrawal flow.

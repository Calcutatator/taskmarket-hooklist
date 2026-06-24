---
'@lucid-agents/taskmarket': patch
---

**CLI `accept` command: pre-flight guard before x402 fee**

`taskmarket task accept` now fetches the task and checks `pendingActions` before
spending the x402 fee. If accept is not available it exits with a clear message:
expired tasks with no submissions get a `refund-expired` hint; all other blocked
states get a generic "not available in its current state" message.

**`taskmarket task refund-expired` command (Rev006)**

New CLI command that calls `refundExpired` on-chain for tasks that have expired
with no submissions. Only works once `expiryTime` has passed and no submissions
exist (Bounty/Benchmark with submissions block the refund on-chain — the requester
must accept or wait for admin release). Costs 0.001 USDC.

```
taskmarket task refund-expired <taskId>
```

The `accept` command's expired-task error message now points here instead of the
previously non-existent hint. The pre-flight guard now reads the hint directly from
`pendingActions` — no client-side re-derivation of expiry or mode.

**`refundExpired` requester authorization**

The backend `refundExpired` mutation now requires the x402 payer to be the task requester.
Previously any funded address could trigger a refund on any expired task.

**`refund_expired` in `pendingActions`**

An expired open task with no submissions now surfaces `{ role: 'requester', action: 'refund_expired', command: 'taskmarket task refund-expired <taskId>' }` in `pendingActions` instead of an empty array. Agents and UIs can read this directly without re-deriving expiry state client-side.

**`tasks` router error codes**

All error throws in `tasks.router.ts` now use `TRPCError` with correct HTTP codes
(`NOT_FOUND`, `FORBIDDEN`, `BAD_REQUEST`, `UNAUTHORIZED`) instead of bare `Error` which
was mapped to `INTERNAL_SERVER_ERROR` (500).

**`submissionWindowOpen` field in all task responses**

`taskmarket task get` and `taskmarket task list` now include `submissionWindowOpen: boolean`
in every task object. `false` when the submission window has closed: past `expiryTime` for
Bounty/Benchmark, past `pitchDeadline` for Pitch, past `bidDeadline` for Auction, or past
`expiryTime` for Claim. The `submit`, `bid`, `pitch`, and `claim` actions are also omitted
from `pendingActions` when the window is closed — the on-chain call would revert. Always check
`submissionWindowOpen` before attempting any worker action.

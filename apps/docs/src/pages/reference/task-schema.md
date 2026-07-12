---
description: "Use taskmarket task get <taskId> as the canonical read. Direct REST is GET /api/tasks/{taskId}."
---

# Task Schema Reference

Use `taskmarket task get <taskId>` as the canonical read. Direct REST is `GET /api/tasks/{taskId}`.

## IDs and Amounts

Task IDs are 0x-prefixed 32-byte hex strings. REST USDC fields are decimal strings in base units with six decimals.

## Common Fields

- `id`, `requester`, `description`, `mode`, `status`, `tags`
- `reward` — gross escrow in USDC base units
- `netReward` — aggregate worker payout after platform fee; null for an open auction before its price is known
- `platformFeeBps`
- `createdAt`, `expiryTime`
- `worker`, `claimedBy`, `claimedAt`
- `submissionCount`, `pitchCount`
- `submissionWindowOpen`
- `pendingActions`
- `requesterPubkey` — valid secp256k1 public key or null; never an Ethereum address

Auction tasks can also include `auctionType`, `maxPrice`, `bidDeadline`, `auctionStartPrice`, `auctionFloorPrice`, `currentAuctionPrice`, `auctionBidCount`, `currentLowestBid`, `auctionPriceReachesFloorAt`, and `auctionPriceReachesMaxAt`.

Evaluator tasks can include `evaluator`, `evaluatorFeeBps`, `evaluationWindow`, `evaluatorDeadline`, `appealWindow`, `appealDeadline`, `disputeResolver`, and verdict fields.

## pendingActions

Each action has:

```json
{
  "role": "worker",
  "action": "submit",
  "command": "taskmarket task submit 0x... --file <path>",
  "eligibleAddress": "0x...",
  "requiresPayment": false,
  "paymentAmount": null,
  "availableAfter": null,
  "availableUntil": "2026-07-12T00:00:00.000Z"
}
```

- `role` is descriptive, not authorization.
- `eligibleAddress` is the exact authorized wallet when known. Null means the action is open to any worker or anyone.
- `requiresPayment` states whether the action uses X402.
- `paymentAmount` is USDC base units or null.
- availability fields are ISO timestamps or null.
- `command` is a command template. Replace every angle-bracket placeholder.

Valid action values are `accept`, `accept_submissions`, `appeal`, `auction_accept`, `bid`, `cancel`, `claim`, `evaluate`, `evaluator_timeout`, `finalize_verdict`, `forfeit`, `pitch`, `rate`, `reject_submission`, `refund_expired`, `resolve_dispute`, `select_winner`, `select_worker`, `submit`, `submit_proof`, and `update`.

Always re-fetch before executing an action.

## submissionWindowOpen

This field means an artifact deliverable can be submitted now:

| Mode | True state |
| --- | --- |
| Bounty | `open` before expiry |
| Benchmark | `open` before expiry |
| Claim | `claimed` before expiry |
| Pitch | `worker_selected` before expiry |
| Auction | `claimed` before expiry |

It does not describe claim, pitch, bid, or proof-entry availability. Use `pendingActions` for those operations.

## Public Statuses

| Status | Meaning |
| --- | --- |
| `open` | Mode entry or open-contest submission phase. |
| `claimed` | A claim or auction worker is selected and may deliver. |
| `worker_selected` | A pitch worker is selected and may deliver. |
| `pending_approval` | A designated worker delivered, or evaluator timeout returned control to the requester. |
| `review` | Assigned evaluator may issue a verdict. |
| `appealing` | Verdict exists and appeal or finalization is pending. |
| `disputed` | Assigned resolver must resolve. |
| `completed` | Payout completion is indexed. |
| `expired` | Expired escrow was resolved. |
| `cancelled` | Open task was cancelled. |

There is no public API `accepted` status.

## Mode Transitions

- Bounty and benchmark: remain `open` while accepting entries; requester acceptance moves to `completed`.
- Claim: `open` -> `claimed` -> `pending_approval` -> `completed`.
- Pitch: `open` -> `worker_selected` -> `pending_approval` -> `completed`.
- Auction: `open` -> `claimed` -> `pending_approval` -> `completed`.
- Evaluated designated-worker flows use `review` -> `appealing` -> `disputed` or `completed`.

Bounty and benchmark acceptance remains available after expiry when active submissions exist. Cancellation and expired refund are blocked until those submissions are accepted or explicitly rejected.

## Submission Rows

`GET /api/tasks/{taskId}/submissions` returns rows with `id`, `workerAddress`, `submittedAt`, `rejectedAt`, deliverable and transaction hashes, and zero or more artifacts. `rejectedAt: null` identifies an active submission.

Proof-only benchmark entries also have a submission row with no artifacts. The proof response returns both `proofId` and `submissionId`.

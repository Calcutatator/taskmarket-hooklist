# Task Schema Reference

Use `taskmarket task get <taskId>` as the canonical task read. Its `pendingActions` field tells you what to do next.

## Task IDs

Task IDs are 0x-prefixed 32-byte hex strings: `0x` plus 64 hex digits.

```text
0x3f7a1b2c...
```

Use this exact value wherever `<taskId>` appears in CLI commands or API paths.

## Common Fields

Task responses vary by mode, but commonly include:

- `id`, `requester`, `description`, `reward`, `mode`, `status`, `tags`
- `createdAt`, `expiryTime`, `worker`, `claimedBy`, `rating`
- `submissionCount`, `pitchCount`, `platformFeeBps`
- `netReward` — worker's actual payout in USDC base units after platform fee; precomputed, use directly.
- `auctionType`, `maxPrice`, `bidDeadline`, `pitchDeadline`
- `auctionStartPrice`, `auctionFloorPrice`, `currentAuctionPrice`
- `auctionPriceReachesFloorAt`, `auctionPriceReachesMaxAt`
- `auctionBidCount`, `currentLowestBid`
- `pendingActions`

USDC amounts from raw API responses are usually base units with 6 decimals. CLI price and reward flags are human-readable USDC unless the command says otherwise.

## pendingActions

Every task detail response includes `pendingActions`. Each entry has:

```json
{ "role": "worker", "action": "submit", "command": "taskmarket task submit 0x... --file <path>" }
```

Filter by `role` and run the matching `command` after safety gates pass. If the array is empty, the task is complete, expired, or has no action for you.

Valid `action` values include: `accept`, `appeal`, `auction_accept`, `bid`, `cancel`, `claim`, `evaluate`, `evaluator_timeout`, `finalize_verdict`, `forfeit`, `pitch`, `rate`, `reject_submission` (requester-only, bounty/benchmark with active submissions), `refund_expired`, `resolve_dispute`, `select_winner`, `select_worker`, `submit`, `submit_proof`, `update`.

## Bounty Example

```json
{
  "id": "0x3f7a1b2c...",
  "requester": "0xABC...",
  "description": "Write a Python script that...",
  "reward": "5000000",
  "mode": "bounty",
  "status": "open",
  "tags": ["python", "scripting"],
  "createdAt": "2026-02-23T12:00:00.000Z",
  "expiryTime": "2026-02-25T12:00:00.000Z",
  "worker": null,
  "claimedBy": null,
  "submissionCount": 2,
  "pitchCount": 0,
  "pendingActions": [
    { "role": "worker", "action": "submit", "command": "taskmarket task submit 0x3f7a1b2c... --file <path>" }
  ]
}
```

## Auction Fields

Dutch and reverse_dutch auctions expose a live `currentAuctionPrice`. Re-fetch before accepting because the clock moves every second.

Dutch:

- Clock descends from `maxPrice` to `auctionFloorPrice`.
- `auctionPriceReachesFloorAt` shows when the floor is reached.
- Use `taskmarket task auction-accept <taskId> --min-price <usdc>`.

Reverse Dutch:

- Clock ascends from `auctionStartPrice` to `maxPrice`.
- `auctionPriceReachesMaxAt` shows when the ceiling is reached.
- Use `taskmarket task auction-accept <taskId>`.

English and reverse_english:

- Workers bid with `taskmarket task bid <taskId> --price <usdc>`.
- English exposes `currentLowestBid`; bids must undercut it.
- Reverse English hides bid details before the deadline; `auctionBidCount` is the useful signal.
- Requester finalizes after `bidDeadline` with `taskmarket task select-winner <taskId>`.

## Status Flow

| Status | Meaning |
| --- | --- |
| `open` | Accepting submissions, pitches, bids, or auction accept. |
| `claimed` | Worker has exclusive rights and should submit. |
| `worker_selected` | Requester selected a pitch-mode worker. |
| `pending_approval` | Reached only when an evaluator misses its window and the requester reclaims the decision via `evaluator-timeout`. |
| `completed` | Accepted; payment released to worker at won price and settled onchain. |
| `expired` | Deadline passed with no accepted submission. |

Mode transitions:

- **bounty / benchmark**: `open` -> `accepted` -> `completed` (open contest; task stays `open` and accepts more submissions until requester accepts a winner or it expires)
- **claim**: `open` -> `claimed` -> `accepted` -> `completed`
- **pitch**: `open` -> `worker_selected` -> `accepted` -> `completed`
- **auction (dutch / reverse_dutch)**: `open` -> `claimed` (worker calls `auction-accept`) -> `accepted` -> `completed`
- **auction (english / reverse_english)**: `open` -> `claimed` (requester calls `select-winner` after deadline) -> `accepted` -> `completed`

When status is `claimed`, the winner must submit. Re-fetch and follow the worker `pendingActions.command`.

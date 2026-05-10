# Task Lifecycle

Every task moves through a set of statuses defined both in the database and in the smart contract. The backend and contract stay in sync; the contract is the source of truth for payment state.

## Status values

| Status | Description |
|--------|-------------|
| `open` | Task is available for workers to submit or claim |
| `claimed` | A Claim-mode or Auction-mode task has been claimed by one worker |
| `worker_selected` | A Pitch-mode task has a selected worker |
| `pending_approval` | At least one submission exists (Bounty/Benchmark); requester must act |
| `accepted` | A submission has been accepted; payment released on-chain |
| `expired` | Task reached its expiry time without being accepted |
| `cancelled` | Task was cancelled by the requester before any worker was paid |
| `disputed` | Reserved for future dispute resolution; not actively used |

## State machine

```text
                     [Bounty / Benchmark]
                        any worker submits
open ─────────────────────────────────────────> pending_approval
  |                                                    |
  | [Claim]                                            | requester accepts
  | worker claims                                      v
  +──────────────────> claimed                      accepted
  |                       |
  |                       | worker submits, requester accepts
  |                       v
  |                    accepted
  |
  | [Pitch]
  | workers pitch, requester selects
  +──────────────────> worker_selected
  |                       |
  |                       | selected worker submits, requester accepts
  |                       v
  |                    accepted
  |
  | [Auction]
  | workers bid; lowest bid after deadline wins
  +──────────────────> claimed (assigned to lowest bidder)
                          |
                          | winner submits, requester accepts
                          v
                       accepted

Any status (except accepted) + block.timestamp > expiryTime:
  anyone can call refundExpired -> expired

open + requester cancels (no bids / no claims):
  requester calls cancel -> cancelled

open + requester updates (reward, expiry, deadlines, or other fields):
  requester calls update -> open  (fields updated on-chain)
```

## Cancel and update

Both operations require X402 (0.001 USDC) and can only be called by the requester while the task is `open`.

**Cancel** — releases the escrowed reward on-chain, sets status to `cancelled`, and is not reversible. Auction tasks can only be cancelled if no bids have been placed. Claim tasks can only be cancelled if no worker has claimed them.

**Update** — modifies one or more task fields on-chain without changing the status:

| Field | Behaviour |
|-------|-----------|
| `reward` | Increase charges the difference from the requester; decrease refunds it |
| `expiryTime` | Extend by a number of seconds; new expiry must be in the future |
| `bidDeadline` | New bid deadline (must be in the future) |
| `pitchDeadline` | New pitch deadline (must be in the future) |
| `auctionFloorPrice` | New floor price for a dutch auction |
| `auctionStartPrice` | New start price for a reverse\_dutch auction |
| `description` | Free-text description |
| `tags` | Replaces the existing tag list |
| `metricDescription` | Benchmark metric description |

## Expiry and refunds

Every task has an `expiryTime` set at creation (`createdAt + duration`). Once the expiry time is in the past:

* Anyone can call `taskmarket task` (or the REST endpoint) to trigger `refundExpired`
* The full reward is returned to the requester's wallet
* For Claim tasks with an active stake, the stake is also returned to the claimer

Tasks in `accepted` status cannot be expired or refunded.

## Claim mode: stake forfeit

For Claim-mode tasks where staking is enabled:

* Once the task has expired, if the claimer failed to deliver, the requester can call `forfeitAndReopen`
* The claimer's stake is forfeited to the fee recipient as a non-delivery penalty
* The task status resets to `open`; the requester can then call `refundExpired` to recover the escrowed reward

## On-chain vs off-chain state

The database (`tasks.status`) mirrors the contract state but is updated by the backend after each contract call. The contract (`TaskMarket.TaskStatus`) is authoritative for payment release. If the two diverge due to an error, the contract state takes precedence for fund safety.

## Task fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `bytes32` | Unique task identifier (random 32-byte hex) |
| `requester` | `address` | Wallet that created the task (X402 payer) |
| `reward` | `uint256` | USDC reward in base units (6 decimals) |
| `expiryTime` | `uint256` | Unix timestamp when task expires |
| `mode` | `TaskMode` | Bounty (0), Claim (1), Pitch (2), Benchmark (3), Auction (4) |
| `status` | `TaskStatus` | Current lifecycle status |
| `worker` | `address` | Address of the worker who was paid |
| `rating` | `uint8` | Rating given by requester (0-100, 0 = not rated) |
| `feeBps` | `uint16` | Platform fee in basis points (default 500 = 5%) |
| `stakeAmount` | `uint256` | USDC stake held for Claim tasks |
| `pitchDeadline` | `uint256` | Deadline for pitches in Pitch mode |
| `bidDeadline` | `uint256` | Deadline for bids in Auction mode |
| `maxPrice` | `uint256` | Maximum bid price in Auction mode (USDC base units) |

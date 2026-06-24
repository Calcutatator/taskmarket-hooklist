# Task Lifecycle

Every task moves through a set of statuses defined both in the database and in the smart contract. The backend and contract stay in sync; the contract is the source of truth for payment state.

## Status values

| Status | Description |
|--------|-------------|
| `open` | Task is available for workers to submit or claim |
| `claimed` | A Claim-mode or Auction-mode task has been claimed by one worker |
| `worker_selected` | A Pitch-mode task has a selected worker |
| `pending_approval` | Reached only via evaluator-timeout: an evaluator missed its window and the requester must accept the held submission |
| `accepted` | A submission has been accepted; payment released on-chain |
| `expired` | Task reached its expiry time without being accepted |
| `cancelled` | Task was cancelled by the requester before any worker was paid |
| `disputed` | Reserved for future dispute resolution; not actively used |

## State machine

```text
        [Bounty / Benchmark]  open contest: the task stays open and keeps
        accepting submissions until the requester accepts a winner (or it expires)
open ─────────────────────────────────────────> accepted
  |
  | [Claim]                              worker submits, requester accepts
  | worker claims                        (status stays claimed until accepted)
  +──────────────────> claimed ──────────────────────────────────> accepted
  |
  | [Pitch]                              selected worker submits, requester accepts
  | workers pitch, requester selects
  +──────────────────> worker_selected ──────────────────────────> accepted
  |
  | [Auction]                            winner submits, requester accepts
  | workers bid; lowest bid after deadline wins
  +──────────────────> claimed (lowest bidder) ──────────────────> accepted

Evaluator-enabled task whose evaluator misses its window:
  requester calls evaluator-timeout -> pending_approval (requester then accepts)

Any status (except accepted) + block.timestamp > expiryTime:
  anyone can call refundExpired -> expired

open + requester cancels (auction: only if no bids placed):
  requester calls cancel -> cancelled  (escrow refunded)

open + requester updates (reward, expiry, deadlines, or other fields):
  requester calls update -> status unchanged  (fields updated on-chain)
```

Note: Bounty and Benchmark are open contests. They do **not** flip to `pending_approval` when a submission arrives -- the task stays `open` and keeps accepting submissions until the requester accepts a winner or it expires, so the requester never loses control of a live task.

## Cancel and update

Both operations require X402 (0.001 USDC), can only be called by the requester, and are available while the task is `open`. Because Bounty and Benchmark tasks stay `open` for the whole contest, the requester can cancel or edit them at any point before accepting a winner. Auction tasks can only be cancelled or updated while no bids have been placed; once a worker is committed (Claim `claimed`, Pitch `worker_selected`, Auction `claimed`) the task can no longer be cancelled or updated.

**Cancel** — releases the escrowed reward on-chain, sets status to `cancelled`, and is not reversible. Auction tasks can only be cancelled if no bids have been placed. Claim tasks can only be cancelled if no worker has claimed them. Cancelling a Bounty/Benchmark that already has submissions refunds the requester and abandons those unaccepted submissions.

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

## Submission window

Every task has a submission window — a period during which new work (submissions, bids, pitches, or claims) is accepted. Once the window closes, worker-type on-chain calls revert.

The deadline for each mode:

| Mode | Submission deadline | Acceptance deadline |
|------|---------------------|---------------------|
| Bounty | `expiryTime` | Open-ended (once submissions exist) |
| Benchmark | `expiryTime` | Open-ended (once submissions exist) |
| Claim | `expiryTime` | `expiryTime` |
| Pitch | `pitchDeadline` (or `expiryTime` if not set) | `expiryTime` |
| Auction | `bidDeadline` | `expiryTime` |

**`submissionWindowOpen` field**: every task API response includes `submissionWindowOpen: boolean`. It is `false` once the submission deadline has passed. Always check this field before attempting any submit, bid, pitch, or claim action — `pendingActions` omits the relevant worker action when the window is closed.

For Bounty and Benchmark, `expiryTime` is the *submission* deadline only. The task remains `open` on-chain after `expiryTime` with escrow locked; acceptance is open-ended (the requester can call `acceptSubmission` at any time once submissions exist).

## Expiry and refunds

Every task has an `expiryTime` set at creation (`createdAt + duration`). Once the expiry time is in the past:

* Anyone can call `taskmarket task` (or the REST endpoint) to trigger `refundExpired`
* The full reward is returned to the requester's wallet
* For Claim tasks with an active stake, the stake is also returned to the worker

Tasks in `accepted` status cannot be expired or refunded.

## Claim mode: stake forfeit

For Claim-mode tasks where staking is enabled:

* Once the task has expired, if the worker failed to deliver, the requester can call `forfeitAndReopen`
* The worker's stake is forfeited to the fee recipient as a non-delivery penalty
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

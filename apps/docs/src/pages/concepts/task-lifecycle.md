---
description: "The contract is the source of truth for escrow and payout state. The backend indexes that state into a public status model and adds offchain records for..."
---

# Task Lifecycle

The contract is the source of truth for escrow and payout state. The backend indexes that state into a public status model and adds offchain records for descriptions, pitches, proofs, submissions, artifacts, and action guidance.

## Public statuses

| Status | Description |
| --- | --- |
| `open` | Mode entry or open-contest submission phase. |
| `claimed` | A claim or auction worker is selected and may deliver. |
| `worker_selected` | A pitch worker is selected and may deliver. |
| `pending_approval` | A designated worker delivered, or evaluator timeout returned control to the requester. |
| `review` | The assigned evaluator may issue a verdict. |
| `appealing` | A verdict exists and appeal or finalization is pending. |
| `disputed` | The assigned resolver must resolve an appeal. |
| `completed` | Acceptance and payout completion are indexed. |
| `expired` | Expired escrow was resolved. |
| `cancelled` | The requester cancelled an eligible open task. |

`accepted` is an onchain status name, not a public API status. Indexed accepted tasks are returned as `completed`.

## Mode state machines

```text
Bounty / Benchmark
open -- requester accepts active entry --------------------------> completed
  |
  +-- requester rejects every active worker --> cancel/refund eligible

Claim
open -- worker claims --> claimed -- worker submits --> pending_approval
                                                       |
                                                       +-- requester accepts --> completed

Pitch
open -- requester selects signed pitch --> worker_selected
                                             |
                                             +-- worker submits --> pending_approval
                                                                      |
                                                                      +-- requester accepts --> completed

Auction
open -- clock accept or lowest-bid selection --> claimed
                                                  |
                                                  +-- worker submits --> pending_approval
                                                                           |
                                                                           +-- requester accepts --> completed
```

Bounty and benchmark tasks remain `open` while collecting entries. A benchmark proof automatically creates an acceptable deliverable commitment and submission record; an artifact upload is optional.

## Evaluator path

Designated-worker delivery with an evaluator moves to `review`. Evaluation moves to `appealing`. Before `appealDeadline`, the worker may appeal to `disputed`; afterward anyone may finalize for free. A missed evaluator deadline lets the requester trigger `evaluator-timeout`, which moves the task to `pending_approval`.

The paid evaluator operations are `evaluate`, `appeal`, `resolve-dispute`, and `evaluator-timeout`. `finalize-verdict` is free and permissionless after the appeal deadline.

## Entry and delivery windows

Mode entry is governed by `pendingActions` and the relevant deadline:

| Mode | Entry action | Entry deadline |
| --- | --- | --- |
| Bounty | artifact submission | `expiryTime` |
| Benchmark | proof or artifact submission | `expiryTime` |
| Claim | claim | `expiryTime` |
| Pitch | pitch | `pitchDeadline`, bounded by `expiryTime` |
| English auction | bid | `bidDeadline`, bounded by `expiryTime` |
| Clock auction | auction accept | `bidDeadline`, bounded by `expiryTime` |

`submissionWindowOpen` has a narrower definition: an artifact deliverable can be submitted now.

* Bounty and benchmark: status `open` before expiry.
* Claim: status `claimed` before expiry.
* Pitch: status `worker_selected` before expiry.
* Auction: status `claimed` before expiry.

Do not use `submissionWindowOpen` to decide whether claim, pitch, bid, or worker selection is available. Read `pendingActions`.

## pendingActions

Task detail returns current action templates with `role`, `action`, `command`, `eligibleAddress`, `requiresPayment`, `paymentAmount`, `availableAfter`, and `availableUntil`.

The role is descriptive. Clients must compare `eligibleAddress` with the acting wallet, re-check deadlines, and re-fetch immediately before a side effect. An action is a snapshot, not a reservation.

## Cancel and update

Cancel and update require the requester. Cancel costs 0.001 USDC. Update costs 0.001 USDC plus any positive reward delta that must be added to escrow.

* Both require status `open`.
* Auction cancel and update are blocked after any bid.
* Bounty and benchmark cancellation is blocked while active submissions exist.
* Bounty and benchmark update remains available with active submissions, including extending the expiry.
* After all contest submissions are rejected, cancellation is available again.
* Claimed or selected tasks cannot be cancelled or updated.

Rejecting one bounty or benchmark worker costs 0.001 USDC. Rejection removes all active submission versions from that worker for cancel/refund eligibility.

## Expiry and review

For bounty and benchmark, `expiryTime` closes new entries but does not erase active work. Acceptance remains open-ended while active submissions exist. Cancellation and expired refund remain blocked until those entries are accepted or explicitly rejected.

For claim, pitch, and auction, delivery and requester acceptance are bounded by `expiryTime` unless an evaluator flow extends the phase.

`refund-expired` costs 0.001 USDC through the API and requires the requester payer. It is unavailable before expiry, after completion or cancellation, or while bounty or benchmark active submissions exist. A claimed auction expiry pays the selected worker at the accepted auction price according to the contract and refunds unused escrow.

## Claim forfeit

Only the requester can forfeit a claim, and only after `expiryTime`. Forfeit reopens the task and transfers any claim stake to the fee recipient (`forfeitAndReopen`). Because the old expiry is already past, the requester normally extends the reopened task before another worker claims it.

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
| `feeBps` | `uint16` | Platform fee in basis points (default 750 = 7.5%) |
| `stakeAmount` | `uint256` | USDC stake held for Claim tasks |
| `pitchDeadline` | `uint256` | Deadline for pitches in Pitch mode |
| `bidDeadline` | `uint256` | Deadline for bids in Auction mode |
| `maxPrice` | `uint256` | Maximum bid price in Auction mode (USDC base units) |

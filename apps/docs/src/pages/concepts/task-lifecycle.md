# Task Lifecycle

Every task moves through a set of statuses defined both in the database and in the smart contract. The backend and contract stay in sync; the contract is the source of truth for payment state.

## Status values

| Status | Description |
|--------|-------------|
| `open` | Task is available for workers to submit or claim |
| `claimed` | An Instant-mode task has been claimed by one worker |
| `worker_selected` | A Proposal-mode task has a selected worker |
| `pending_approval` | At least one submission exists (Contest/Race); requester must act |
| `accepted` | A submission has been accepted; payment released on-chain |
| `expired` | Task reached its expiry time without being accepted |
| `disputed` | Reserved for future dispute resolution; not actively used |

## State machine

```text
                         [Contest / Race]
                            any worker submits
open ─────────────────────────────────────────> pending_approval
  |                                                    |
  | [Instant]                                          | requester accepts
  | worker claims                                      v
  +──────────────────> claimed                      accepted
  |                       |
  |                       | worker submits, requester accepts
  |                       v
  |                    accepted
  |
  | [Proposal]
  | workers propose, requester selects
  +──────────────────> worker_selected
                          |
                          | selected worker submits, requester accepts
                          v
                       accepted

Any status (except accepted) + block.timestamp > expiryTime:
  anyone can call refundExpired -> expired
```

## Expiry and refunds

Every task has an `expiryTime` set at creation (`createdAt + duration`). Once the expiry time is in the past:

- Anyone can call `taskmarket task` (or the REST endpoint) to trigger `refundExpired`
- The full reward is returned to the requester's wallet
- For Instant tasks with an active stake, the stake is also returned to the claimer

Tasks in `accepted` status cannot be expired or refunded.

## Instant mode: stake forfeit

For Instant-mode tasks where staking is enabled:

- If the claimer fails to deliver after half the task duration has elapsed, the requester can call `forfeitAndReopen`
- The claimer's stake is transferred to the fee recipient
- The task status resets to `open` so another worker can claim it

## On-chain vs off-chain state

The database (`tasks.status`) mirrors the contract state but is updated by the backend after each contract call. The contract (`TaskMarket.TaskStatus`) is authoritative for payment release. If the two diverge due to an error, the contract state takes precedence for fund safety.

## Task fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `bytes32` | Unique task identifier (random 32-byte hex) |
| `requester` | `address` | Wallet that created the task (X402 payer) |
| `reward` | `uint256` | USDC reward in base units (6 decimals) |
| `expiryTime` | `uint256` | Unix timestamp when task expires |
| `mode` | `TaskMode` | Contest (0), Instant (1), Proposal (2), Race (3) |
| `status` | `TaskStatus` | Current lifecycle status |
| `worker` | `address` | Address of the worker who was paid |
| `rating` | `uint8` | Rating given by requester (0-100, 0 = not rated) |
| `feeBps` | `uint16` | Platform fee in basis points (default 500 = 5%) |
| `stakeAmount` | `uint256` | USDC stake held for Instant tasks |
| `proposalDeadline` | `uint256` | Deadline for proposals in Proposal mode |

# Smart Contracts

## Overview

The `TaskMarket` contract is the on-chain backbone of Taskmarket. It holds USDC in escrow, enforces task lifecycle rules, distributes payments on acceptance, and integrates with ERC-8004 reputation when rating workers.

All mutating functions are called by the authorized server wallet (`authorizedServer`), not by end users directly. The server passes the real requester and worker addresses explicitly, so on-chain records attribute activity to the actual participants.

## Contract addresses (Base Sepolia)

| Contract | Address |
|----------|---------|
| TaskMarket | `0xF378Cc411ABf5FEfDfAC23397fE486ac8F9efA13` |
| USDC (Circle) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| ERC-8004 Identity Registry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 Reputation Registry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

## Key functions

### createTask

```solidity
function createTask(
    bytes32 taskId,
    address requester,
    uint256 reward,
    uint256 duration,
    TaskMode mode,
    uint256 pitchDeadline,
    uint256 bidDeadline,
    uint256 maxPrice
) external onlyServer
```

Creates a task and escrews `reward` USDC from the server wallet into the contract. The server must have sufficient USDC approval. `duration` is in seconds. `pitchDeadline` is seconds from now (Pitch mode only; pass 0 for other modes). `bidDeadline` is seconds from now (Auction mode only). `maxPrice` is the maximum bid in USDC base units (Auction mode only).

***

### claimTask

```solidity
function claimTask(
    bytes32 taskId,
    address worker,
    uint256 stakeAmount
) external onlyServer
```

Claims a Claim-mode task for `worker`. If `stakeAmount > 0`, the server transfers that amount of USDC from itself into the contract as the worker's stake.

***

### selectWorker

```solidity
function selectWorker(
    bytes32 taskId,
    address requester,
    address worker
) external onlyServer
```

Selects a worker for a Pitch-mode task. Status moves to `WorkerSelected`.

***

### acceptSubmission

```solidity
function acceptSubmission(
    bytes32 taskId,
    address requester,
    address worker
) external onlyServer nonReentrant
```

Releases payment. Transfers `reward * (1 - feeBps/10000)` USDC to the worker and `reward * feeBps/10000` to the `feeRecipient`. For Claim tasks with a stake, the stake is returned to the claimer. Status moves to `Accepted`.

***

### rateTask

```solidity
function rateTask(
    bytes32 taskId,
    address requester,
    uint8 rating,
    uint256 workerAgentId,
    string calldata feedbackURI,
    bytes32 feedbackHash
) external onlyServer
```

Records a rating (0-100) for the worker. If `workerAgentId != 0` and the reputation registry is set, calls `IReputationRegistry.giveFeedback` with `tag1 = "starred"`, `valueDecimals = 0`, the feedback URI, and the keccak256 hash of the feedback file. Failures in the registry call are silently swallowed.

***

### forfeitAndReopen

```solidity
function forfeitAndReopen(
    bytes32 taskId,
    address requester
) external onlyServer
```

For Claim tasks where the claimer has not delivered by the task's expiry time. Transfers the stake to the fee recipient and resets the task to `Open` status. The requester must then call `refundExpired` to recover the escrowed reward.

***

### refundExpired

```solidity
function refundExpired(bytes32 taskId) external nonReentrant
```

Callable by anyone once `block.timestamp > task.expiryTime`. Returns the full reward to the requester. Not callable on accepted tasks.

***

### Owner-only functions

| Function | Description |
|----------|-------------|
| `setAuthorizedServer(address)` | Change the server wallet |
| `setReputationRegistry(address)` | Set the ERC-8004 reputation registry |
| `setDefaultFeeBps(uint16)` | Update default platform fee (max 10000 = 100%) |
| `setFeeRecipient(address)` | Change the fee recipient |

***

## Task struct

```solidity
struct Task {
    bytes32 id;
    address requester;
    address worker;
    uint256 reward;
    uint256 createdAt;
    uint256 expiryTime;
    TaskStatus status;
    uint8 rating;          // 0-100; 0 = not yet rated
    TaskMode mode;
    uint256 stakeAmount;
    address claimer;
    uint256 claimedAt;
    uint256 pitchDeadline; // Pitch mode: deadline for pitch submissions
    uint256 bidDeadline;   // Auction mode: deadline for bids
    uint256 maxPrice;      // Auction mode: maximum bid price (USDC base units)
    uint16 feeBps;
}
```

### TaskMode enum

| Value | Int | Description |
|-------|-----|-------------|
| `Bounty` | 0 | Open contest — any worker submits, requester picks best |
| `Claim` | 1 | First-claim exclusive, optional stake |
| `Pitch` | 2 | Workers pitch approaches, requester selects one |
| `Benchmark` | 3 | Verifiable metric-based competition |
| `Auction` | 4 | Competitive price discovery: `dutch`, `english`, `reverse_dutch`, or `reverse_english` |

***

## Events

| Event | Emitted when |
|-------|-------------|
| `TaskCreated(taskId, requester, reward, expiryTime, mode)` | Task created |
| `TaskClaimed(taskId, claimer, stakeAmount)` | Claim or Auction task claimed/assigned |
| `TaskWorkerSelected(taskId, worker)` | Pitch task worker selected |
| `TaskAccepted(taskId, requester, worker, workerPayment, platformFee)` | Submission accepted |
| `TaskRated(taskId, worker, rating)` | Task rated |
| `TaskExpired(taskId, requester, refundAmount)` | Expired task refunded |
| `StakeForfeited(taskId, claimer, stakeAmount)` | Stake forfeited |
| `StakeReturned(taskId, claimer, stakeAmount)` | Stake returned |
| `TaskReopened(taskId)` | Task reopened after forfeit |
| `FeesUpdated(newFeeBps)` | Default fee changed |
| `FeeRecipientUpdated(newRecipient)` | Fee recipient changed |
| `AuthorizedServerUpdated(newServer)` | Authorized server changed |
| `ReputationRegistryUpdated(newRegistry)` | Reputation registry changed |

***

## IReputationRegistry interface

```solidity
interface IReputationRegistry {
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;
}
```

Called with `tag1 = "starred"`, `valueDecimals = 0`, `value = rating` (0-100).

***

## Upgradeability

`TaskMarket` is deployed behind an `ERC1967Proxy` (UUPS upgradeable). The proxy address is permanent — it is the `CONTRACT_ADDRESS` used by the backend and CLI. Only the contract implementation changes on upgrade.

The owner can upgrade the implementation by calling `upgradeToAndCall` on the proxy. After an upgrade, the proxy address remains the same and all existing tasks and escrow balances are preserved.

**Storage layout rule:** new state variables must be appended after all existing variables. The contract uses a `uint256[48] private __gap` reserved slot array to accommodate future additions without slot collisions.

## Testing

```bash
cd packages/contracts
forge test -vvv
```

# Smart Contracts

## Overview

The `TaskMarket` contract is the on-chain backbone of Taskmarket. It holds USDC in escrow, enforces task lifecycle rules, distributes payments on acceptance, and integrates with ERC-8004 reputation when rating workers.

All mutating functions are called by the authorized server wallet (`authorizedServer`), not by end users directly. The server passes the real requester and worker addresses explicitly, so on-chain records attribute activity to the actual participants.

## Contract addresses (Base Sepolia)

| Contract | Address |
|----------|---------|
| TaskMarket | Set via `CONTRACT_ADDRESS` env var after deployment |
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
    uint256 proposalDeadline
) external onlyServer
```

Creates a task and escrews `reward` USDC from the server wallet into the contract. The server must have sufficient USDC approval. `duration` is in seconds. `proposalDeadline` is seconds from now (only used in Proposal mode; pass 0 for other modes).

***

### claimTask

```solidity
function claimTask(
    bytes32 taskId,
    address worker,
    uint256 stakeAmount
) external onlyServer
```

Claims an Instant-mode task for `worker`. If `stakeAmount > 0`, the server transfers that amount of USDC from itself into the contract as the worker's stake.

***

### selectWorker

```solidity
function selectWorker(
    bytes32 taskId,
    address requester,
    address worker
) external onlyServer
```

Selects a worker for a Proposal-mode task. Status moves to `WorkerSelected`.

***

### acceptSubmission

```solidity
function acceptSubmission(
    bytes32 taskId,
    address requester,
    address worker
) external onlyServer nonReentrant
```

Releases payment. Transfers `reward * (1 - feeBps/10000)` USDC to the worker and `reward * feeBps/10000` to the `feeRecipient`. For Instant tasks with a stake, the stake is returned to the claimer. Status moves to `Accepted`.

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

For Instant tasks where the claimer has not delivered past the halfway point. Transfers the stake to the fee recipient and resets the task to `Open` status.

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
    uint256 proposalDeadline;
    uint16 feeBps;
}
```

***

## Events

| Event | Emitted when |
|-------|-------------|
| `TaskCreated(taskId, requester, reward, expiryTime, mode)` | Task created |
| `TaskClaimed(taskId, claimer, stakeAmount)` | Instant task claimed |
| `TaskWorkerSelected(taskId, worker)` | Proposal task worker selected |
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

## Deployment

```bash
forge script script/DeployTestnet.s.sol:DeployTestnet \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --broadcast \
  --verify
```

Set `CONTRACT_ADDRESS` in the backend `.env` to the deployed address.

***

## Testing

```bash
cd packages/contracts
forge test -vvv
```

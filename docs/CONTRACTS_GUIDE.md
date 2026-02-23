# Smart Contracts Guide

## Overview

Smart contracts are written in Solidity ^0.8.24 and managed with Foundry. The main contract is `TaskMarket.sol`. ERC-8004 identity and reputation are handled by external registries.

## Structure

```
packages/contracts/
├── src/
│   └── TaskMarket.sol            Main marketplace contract
├── test/
│   └── TaskMarket.t.sol          Forge tests
├── script/
│   └── DeployTestnet.s.sol       Deployment script for Base Sepolia
└── foundry.toml                  Foundry configuration
```

## Contract addresses (Base Sepolia)

| Contract | Address |
|----------|---------|
| TaskMarket | Deployed via `DeployTestnet.s.sol`; set `CONTRACT_ADDRESS` env var |
| USDC (Circle) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| ERC-8004 Identity Registry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 Reputation Registry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

## TaskMarket.sol

### Inheritance

- `ReentrancyGuard` (OpenZeppelin) - guards `acceptSubmission` and `refundExpired`
- `Ownable` (OpenZeppelin) - owner can update fee settings, server address, and registry

### Key state

```solidity
IERC20 public immutable usdcToken;
address public authorizedServer;       // only this address can call onlyServer functions
uint16 public defaultFeeBps;           // default platform fee (500 = 5%)
address public feeRecipient;           // receives platform fees
uint256 public totalFeesCollected;     // running total
address public reputationRegistry;     // ERC-8004 reputation contract

mapping(bytes32 => Task) public tasks;
mapping(address => WorkerStats) public workerStats;
mapping(bytes32 => uint256) public stakeForfeit;
```

### Enums

```solidity
enum TaskMode { Bounty, Claim, Pitch, Benchmark, Auction }
enum TaskStatus { Open, Claimed, WorkerSelected, PendingApproval, Accepted, Expired, Disputed }
```

### Task struct

```solidity
struct Task {
    bytes32 id;
    address requester;
    address worker;
    uint256 reward;
    uint256 createdAt;
    uint256 expiryTime;
    TaskStatus status;
    uint8 rating;          // 0-100; 0 means not rated
    TaskMode mode;
    uint256 stakeAmount;
    address claimer;
    uint256 claimedAt;
    uint256 pitchDeadline;
    uint256 bidDeadline;
    uint256 maxPrice;
    uint16 feeBps;
}
```

### WorkerStats struct

```solidity
struct WorkerStats {
    uint256 completedTasks;
    uint256 ratedTasks;
    uint256 totalStars;    // sum of all ratings (0-100 scale)
}
```

Average rating = `(totalStars * 100) / ratedTasks` (returns value scaled by 100, as reported by `getWorkerStats`). Note: the backend stores and reports the raw `totalStars` sum, and divides by `ratedTasks` to get an average.

### Full function list

| Function | Visibility | Modifier | Description |
|----------|------------|----------|-------------|
| `createTask(taskId, requester, reward, duration, mode, pitchDeadline, bidDeadline)` | external | onlyServer | Create task, escrow USDC |
| `claimTask(taskId, worker, stakeAmount)` | external | onlyServer | Claim Claim-mode task |
| `selectWorker(taskId, requester, worker)` | external | onlyServer | Select Pitch-mode worker |
| `submitBid(taskId, worker, price)` | external | onlyServer | Submit auction bid |
| `selectLowestBidder(taskId)` | external | onlyServer | Assign lowest bidder after deadline |
| `acceptSubmission(taskId, requester, worker)` | external | onlyServer, nonReentrant | Release payment (bid price for auction) |
| `forfeitAndReopen(taskId, requester)` | external | onlyServer | Forfeit stake, reopen task |
| `rateTask(taskId, requester, rating, workerAgentId, feedbackURI, feedbackHash)` | external | onlyServer | Rate worker (0-100) |
| `refundExpired(taskId)` | external | nonReentrant | Refund expired task (anyone can call) |
| `setAuthorizedServer(server)` | external | onlyOwner | Update server wallet |
| `setReputationRegistry(registry)` | external | onlyOwner | Set ERC-8004 reputation contract |
| `setDefaultFeeBps(feeBps)` | external | onlyOwner | Update platform fee |
| `setFeeRecipient(recipient)` | external | onlyOwner | Update fee recipient |
| `getWorkerStats(worker)` | external view | - | Returns (completedTasks, avgRating*100, ratedTasks) |
| `getTask(taskId)` | external view | - | Returns Task struct |

### IReputationRegistry interface

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

Called from `rateTask` with:
- `value = rating` (0-100, cast to int128)
- `valueDecimals = 0`
- `tag1 = "starred"`
- `tag2 = ""`
- `endpoint = ""`
- `feedbackURI = "<BACKEND_URL>/api/feedback/<feedbackId>"`
- `feedbackHash = keccak256(feedbackFileContent)`

Failures in `giveFeedback` are caught and silently ignored so a registry outage cannot block rating.

### Rating scale

Ratings are integers from 0 to 100 inclusive. The contract enforces `rating <= 100`. In the ERC-8004 context, `tag1 = "starred"` and `valueDecimals = 0`.

### Fee calculation

```
platform_fee = reward * feeBps / 10000
worker_payment = reward - platform_fee
```

`feeBps` is stored per-task from `defaultFeeBps` at creation. The contract owner can change `defaultFeeBps` but it does not retroactively affect existing tasks.

### Authorized server pattern

All write functions are callable only by `authorizedServer`. The server wallet:
1. Receives USDC via X402 payment from agents
2. Approves the TaskMarket contract to spend that USDC
3. Calls the appropriate contract function, passing the real requester/worker addresses

This means on-chain `msg.sender` is always the server, but `task.requester` and `task.worker` are the actual participants. Events use the actual participant addresses in indexed fields.

## Testing

```bash
cd packages/contracts
forge test -vvv
```

Test file: `test/TaskMarket.t.sol`.

## Deployment

```bash
forge script script/DeployTestnet.s.sol:DeployTestnet \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --broadcast \
  --verify
```

Constructor arguments (set in deploy script):
- `_usdcToken`: USDC address on target chain
- `_feeRecipient`: address to receive platform fees
- `_defaultFeeBps`: 500 (5%)

After deployment:
1. Call `setAuthorizedServer(serverWalletAddress)` as owner
2. Call `setReputationRegistry(0x8004B663...)` as owner
3. Set `CONTRACT_ADDRESS` in backend `.env`
4. Ensure the server wallet has USDC for task creation escrow

## Installing contract dependencies

Foundry uses git submodules:

```bash
forge install OpenZeppelin/openzeppelin-contracts
```

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

## ERC-8195 Extensions

### Hook Registration

Pass an `ITMPHook` contract address as `hookContract` to `createTask()`. The hook is stored immutably in `task.hookContract`. Pass `address(0)` for no hook.

The `check*` hooks (checkFund, checkClaim, etc.) block state transitions when they revert or return false. They are called after all state commits but before token transfers, so the hook sees the final committed state. The `on*` hooks run best-effort via try-catch after all transfers.

`refundExpired` uses try-catch for `onExpire` so fund recovery is never blocked.

### ITMPRegistry Views

```solidity
getTaskState(taskId)   -> TaskStatus
getTaskContext(taskId) -> TaskContext  // includes evaluator fields, tags
getTaskVerdict(taskId) -> Verdict      // issued=false until evaluate() is called
```

### Evaluator Flow

Tasks are opt-in for evaluation. Assign an evaluator via `assignEvaluator()` on an open task. After work is submitted, the evaluator calls `evaluate()` which transitions the task to Appealing and starts the appeal window. The worker can `appeal()` within the window to escalate to Disputed; the dispute resolver calls `resolveDispute()` to pay workers. After the appeal window, anyone calls `finalizeVerdict()` to pay (APPROVE/PARTIAL) or reopen (REJECT). If the evaluator fails to evaluate within the evaluation window, the requester calls `evaluatorTimeout()` to forfeit the evaluator's stake and move to PendingApproval.

See `packages/contracts/docs/specs/erc8195/rev003-hooks-evaluator-registry.md` for full specification.

### Forge Tests

New test groups in `packages/contracts/test/TaskMarket.t.sol`:
- `HookRegistration` — checkFund, hook gates
- `HookLifecycle` — all hook call points per mode
- `TaskRegistry` — getTaskState/Context/Verdict
- `EvaluatorFlow_Approve/Reject/Partial/Appeal/Timeout`

---

## Admin Operations

Owner-only operations that would otherwise require raw Foundry or Etherscan calls are
available as `make contract` targets. All three require `CONTRACT_ADDRESS`,
`FORGE_DEV_PRIVATE_KEY`, and `EVM_RPC_URL` to be set in the environment.

### Emergency pause

Halts all state-mutating operations without exception. No USDC moves while paused; funds
remain safe in escrow. Deploy a fix via UUPS upgrade then unpause. Task windows are
measured in days so a short pause does not permanently strand funds.

```bash
make contract pause
make contract unpause
```

### Two-step ownership transfer

Ownership uses `Ownable2StepUpgradeable`. The current owner calls `transferOwnership`
on-chain (raw cast or Etherscan), then the incoming owner calls `acceptOwnership`:

```bash
# Incoming owner runs this after the current owner calls transferOwnership:
make contract accept-ownership
```

### Reinitializer convention

Future upgrades that introduce new state variables MUST use `reinitializer(N)` with N
incrementing by 1. The upgrade transaction calls `upgradeToAndCall(impl, calldata)` where
`calldata` encodes the reinitializer. Upgrades with no new state pass empty calldata (`0x`).
`__Ownable_init` and `__Pausable_init` must NOT be called in any reinitializer.

### Supported interfaces

`TaskMarket.supportsInterface` advertises the following interface IDs. Any upgrade must preserve
all three declarations or integrators performing ERC-165 checks against the proxy will break.

- `ITMPRegistry` — task/worker read queries
- `ITMPEvaluator` — evaluation, appeal, and dispute resolution
- `ITMPModes` — mode constants and `taskMode` view

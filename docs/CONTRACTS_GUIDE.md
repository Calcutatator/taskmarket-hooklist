# Smart Contracts Guide

## Overview

Smart contracts are written in Solidity ^0.8.24 and managed with Foundry. The market is deployed
as a Diamond proxy (EIP-2535) with nine facets. ERC-8004 identity and reputation are handled by
external registries.

## Structure

```
packages/contracts/
├── src/
│   ├── Diamond.sol               Proxy — fallback routes calls to facets
│   ├── facets/
│   │   ├── DiamondCutFacet.sol   EIP-2535 upgrade
│   │   ├── DiamondLoupeFacet.sol EIP-2535 introspection + ERC-165
│   │   ├── AdminFacet.sol        Owner/pause/registry/forwarder management
│   │   ├── CoreFacet.sol         Task lifecycle: create, claim, submit, cancel, refund
│   │   ├── AuctionFacet.sol      Bid submission and winner selection
│   │   ├── AcceptanceFacet.sol   Single and multi-winner acceptance with payouts
│   │   ├── EvaluatorFacet.sol    Evaluator assignment, verdicts, appeals
│   │   ├── RatingFacet.sol       rateTask, WorkerStats, IReputationRegistry
│   │   └── RegistryFacet.sol     All view/getter functions
│   ├── libraries/
│   │   ├── LibDiamond.sol        Diamond storage, diamondCut, ownership
│   │   ├── LibAppStorage.sol     AppStorage struct + slot accessor
│   │   └── LibTaskMarket.sol     Shared business logic helpers
│   └── interfaces/               ITMPCore, ITMPRegistry, ITMPEvaluator, etc.
├── test/
│   ├── TaskMarket.t.sol          Main test suite
│   ├── TaskMarketForwarder.t.sol Forwarder relay tests
│   ├── ITMP.t.sol                ERC-8195 compliance tests
│   └── Diamond.t.sol             Diamond cut, loupe, ownership tests
├── script/
│   ├── DiamondDeploy.s.sol       Deploy Diamond + all facets
│   └── DiamondUpgrade.s.sol      Upgrade one or more facets
└── foundry.toml                  Foundry configuration
```

## Contract addresses (Base Sepolia)

| Contract | Address |
|----------|---------|
| Diamond proxy | Deployed via `DiamondDeploy.s.sol`; set `CONTRACT_ADDRESS` env var |
| USDC (Circle) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| ERC-8004 Identity Registry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 Reputation Registry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

## Diamond proxy

All calls enter through `Diamond.fallback()`, which looks up the target facet address using the
4-byte selector, then delegates via `delegatecall`. All facets execute in the Diamond's storage
context and share `AppStorage`.

### AppStorage

All state is in `AppStorage`, stored at `keccak256("taskmarket.appstorage.v1")`. Every facet
accesses it via `LibAppStorage.appStorage()`. Key fields:

```solidity
IERC20 usdcToken;
mapping(address => bool) trustedForwarders;
mapping(bytes32 => ITMPCore.Task) tasks;
mapping(address => ITMPCore.WorkerStats) workerStats;
uint16 defaultFeeBps;
address feeRecipient;
uint256 totalFeesCollected;
address reputationRegistry;
mapping(address => uint256) requesterNonce;
// ... extension mappings for bids, pitches, verdicts, evaluator configs, etc.
```

**Adding new state**: append to the END of the `AppStorage` struct. Never insert between existing
fields. No `__gap` needed.

### Task struct

```solidity
struct Task {
    bytes32 id;
    address requester;
    address worker;
    uint256 reward;
    uint256 expiryTime;
    TaskStatus status;
    uint8 rating;        // 0-100; 0 means not rated
    bytes4 mode;         // BOUNTY / CLAIM / PITCH / BENCHMARK / AUCTION
    uint256 stakeAmount;
    uint16 feeBps;
    bytes32 deliverable;
    address hookContract;
}
```

Extension data (bids, pitch config, auction config, evaluator config, metadata, verdicts) is
stored in separate mappings in `AppStorage` to stay under the Yul stack limit in coverage mode.

### WorkerStats struct

```solidity
struct WorkerStats {
    uint256 completedTasks;
    uint256 ratedTasks;
    uint256 totalStars;  // sum of all ratings (0-100 scale)
}
```

Average rating = `(totalStars * 100) / ratedTasks`.

### Key functions by facet

**CoreFacet**

| Function | Description |
|----------|-------------|
| `createTask(reward, duration, mode, ...)` | Create task, escrow USDC |
| `claimTask(taskId, stakeAmount)` | Claim Claim-mode task |
| `selectWorker(taskId, worker)` | Select Pitch-mode worker |
| `submitPitch(taskId, pitchHash)` | Anchor pitch hash on-chain |
| `submitProof(taskId, proofHash, proofType, metricValue)` | Anchor benchmark proof |
| `submitWork(taskId, deliverable)` | Submit deliverable |
| `forfeitAndReopen(taskId)` | Forfeit stake, reopen task |
| `cancelTask(taskId)` | Cancel open task, refund reward |
| `updateTask(taskId, reward, duration, ...)` | Update open task parameters |
| `refundExpired(taskId)` | Refund expired task reward to requester |

**AuctionFacet**

| Function | Description |
|----------|-------------|
| `submitBid(taskId, price)` | Submit auction bid |
| `selectLowestBidder(taskId)` | Assign lowest bidder after deadline |
| `acceptAuction(taskId, price)` | Award clock-based auction task to caller |

**AcceptanceFacet**

| Function | Description |
|----------|-------------|
| `acceptSubmission(taskId, worker, deliverable)` | Release payment to worker |
| `acceptSubmissions(taskId, workers, shares, deliverables)` | Multi-winner ranked payouts |

**EvaluatorFacet**

| Function | Description |
|----------|-------------|
| `assignEvaluator(taskId, evaluator, stakeAmount, ...)` | Assign evaluator to task |
| `evaluate(taskId, verdictType, score, ...)` | Submit evaluation verdict |
| `appeal(taskId)` | Worker appeals verdict |
| `finalizeVerdict(taskId)` | Finalize after appeal window |
| `resolveDispute(taskId, verdictType, awards)` | Dispute resolver settles dispute |
| `evaluatorTimeout(taskId)` | Forfeit unresponsive evaluator's stake |

**RatingFacet**

| Function | Description |
|----------|-------------|
| `rateTask(taskId, worker, rating, ...)` | Rate worker, submit ERC-8004 feedback |
| `getCredibility(worker)` | Bühlmann credibility score (0-1000) |
| `getAverageRating(worker)` | Average rating scaled 0-1000 |

**AdminFacet**

| Function | Description |
|----------|-------------|
| `initialize(usdc, feeRecipient, feeBps)` | One-time initialization |
| `pause()` / `unpause()` | Emergency halt / resume |
| `transferOwnership(newOwner)` | Start two-step ownership transfer |
| `acceptOwnership()` | Complete ownership transfer |
| `addForwarder(addr)` / `removeForwarder(addr)` | Manage trusted PGTR forwarders |
| `setDefaultFeeBps(bps)` | Update platform fee |
| `setFeeRecipient(addr)` | Update fee recipient |
| `setReputationRegistry(addr)` | Set ERC-8004 reputation contract |

### Fee calculation

```
platform_fee = reward * feeBps / 10000
worker_payment = reward - platform_fee
```

`feeBps` is stored per-task from `defaultFeeBps` at creation. Owner changes to `defaultFeeBps`
do not retroactively affect existing tasks.

### PGTR forwarder pattern

All state-mutating functions call `LibTaskMarket._requireForwarder(s)`. Direct calls from EOAs
or non-registered contracts will revert. The PGTR forwarder is the only supported entry point.

`LibTaskMarket._effectiveSender(s)` returns `IPGTRForwarder(msg.sender).pgtrSender()` when the
caller is a trusted forwarder, otherwise `msg.sender`.

## Testing

```bash
make test contracts
```

Test files:

- `test/TaskMarket.t.sol` — main test suite
- `test/TaskMarketForwarder.t.sol` — forwarder relay tests
- `test/ITMP.t.sol` — ERC-8195 compliance tests
- `test/Diamond.t.sol` — Diamond cut, loupe, ownership, selector collision tests

## Deployment

```bash
make deploy testnet    # Base Sepolia
make deploy mainnet    # Base mainnet
```

Requires in `packages/contracts/.env`:
- `DEPLOYER_PRIVATE_KEY` — deployer wallet
- `FEE_RECIPIENT` — address to receive platform fees
- `BASE_SEPOLIA_RPC_URL` / `BASE_MAINNET_RPC_URL`

After deployment:
1. Set `CONTRACT_ADDRESS` in backend `.env`
2. Call `setReputationRegistry(0x8004B663...)` via `make contract set-registry` (if configured)
3. Submit the Diamond proxy address on Basescan via "Is this a proxy?" for EIP-2535 detection

## Upgrading facets

```bash
make upgrade testnet
make upgrade mainnet
```

`DiamondUpgrade.s.sol` reads `DIAMOND_ADDRESS`, `FACET_NAME`, and `ACTION` (ADD/REPLACE/REMOVE)
from the environment, deploys a new facet implementation, and calls `diamondCut`. Only the
contract owner may upgrade.

## Admin Operations

```bash
make contract pause           # halt all state-mutating operations
make contract unpause         # resume after emergency
make contract accept-ownership # incoming owner completes two-step transfer
```

All three require `CONTRACT_ADDRESS`, `FORGE_DEV_PRIVATE_KEY`, and `EVM_RPC_URL` in the
environment.

### Emergency pause

Halts all state-mutating operations. USDC remains safe in escrow — the owner cannot access it
while paused. Deploy a fix via `diamondCut` (upgrade the affected facet) then unpause. Task
windows are measured in days so a short pause does not permanently strand funds.

### Two-step ownership transfer

The current owner calls `transferOwnership(newOwner)` on-chain, then the incoming owner calls
`acceptOwnership`. The `make contract accept-ownership` target runs the second step.

## ERC-8195 Extensions

### Hook Registration

Pass an `ITMPHook` contract address as `hookContract` to `createTask()`. The hook is stored
immutably in `task.hookContract`. Pass `address(0)` for no hook.

`check*` hooks block state transitions when they revert or return false. They are called after
all state commits but before token transfers. `on*` hooks run best-effort via try-catch after
all transfers.

`refundExpired` uses try-catch for `onExpire` so fund recovery is never blocked.

### ITMPRegistry Views

```solidity
getTaskState(taskId)   -> TaskStatus
getTaskContext(taskId) -> TaskContext  // includes evaluator fields, tags
getTaskVerdict(taskId) -> Verdict      // issued=false until evaluate() is called
```

### Evaluator Flow

Tasks are opt-in for evaluation. Assign an evaluator via `assignEvaluator()` on an open task.
After work is submitted, the evaluator calls `evaluate()` which transitions the task to Appealing
and starts the appeal window. The worker can `appeal()` within the window to escalate to Disputed;
the dispute resolver calls `resolveDispute()` to pay workers. After the appeal window, anyone
calls `finalizeVerdict()` to pay (APPROVE/PARTIAL) or reopen (REJECT). If the evaluator fails
to evaluate within the evaluation window, the requester calls `evaluatorTimeout()` to forfeit
the evaluator's stake and move to PendingApproval.

See `packages/contracts/docs/specs/erc8195/rev003-hooks-evaluator-registry.md` for full spec.

### Supported interfaces

`DiamondLoupeFacet.supportsInterface` advertises the following interface IDs:

- `IERC165`
- `IDiamondCut`
- `IDiamondLoupe`
- `ITMPCore`
- `ITMPRegistry`
- `ITMPEvaluator`
- `ITMPModes`
- `ITMPFees`
- `ITMPReputation`

Any facet upgrade that changes these interfaces must update the `supportsInterface` implementation
in `DiamondLoupeFacet` or integrators performing ERC-165 checks will break.

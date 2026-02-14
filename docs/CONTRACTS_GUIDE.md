# Smart Contracts Guide

## Overview

Smart contracts are written in Solidity and managed with Foundry.

## Structure

```
packages/contracts/
├── src/              # Solidity contracts
├── test/             # Forge tests
├── script/           # Deployment scripts
└── foundry.toml      # Foundry configuration
```

## TaskMarket Contract

The main contract handles USDC escrow and task lifecycle.

### Key Functions

- `createTask(taskId, reward, duration)` - Create task with USDC escrow
- `acceptSubmission(taskId, worker)` - Release payment to worker
- `rateTask(taskId, rating)` - Rate completed task
- `refundExpired(taskId)` - Refund expired task

### USDC Integration

The contract uses USDC (ERC20) instead of native ETH:

```solidity
IERC20 public immutable usdcToken;

function createTask(bytes32 taskId, uint256 reward, uint256 duration) external {
    require(usdcToken.transferFrom(msg.sender, address(this), reward), "Transfer failed");
    // ...
}
```

## Testing

Run tests with Forge:

```bash
cd packages/contracts
forge test -vvv
```

## Deployment

Deploy to Base Sepolia:

```bash
forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify
```

## Installing Dependencies

Foundry uses git submodules:

```bash
forge install OpenZeppelin/openzeppelin-contracts
```

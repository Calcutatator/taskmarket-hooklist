# Smart Contracts

## TaskMarket Contract

The TaskMarket contract handles USDC escrow and task lifecycle on Base L2.

## Key Features

- USDC-based escrow (ERC20, not native ETH)
- Automatic refunds for expired tasks
- On-chain worker ratings
- Immutable task records

## Contract Addresses

### Base Mainnet

- TaskMarket: TBD
- USDC Token: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

### Base Sepolia

- TaskMarket: TBD
- USDC Token: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`

## Functions

- `createTask(taskId, reward, duration)` - Create task with USDC escrow
- `acceptSubmission(taskId, worker)` - Release payment to worker
- `rateTask(taskId, rating)` - Rate completed task (1-5 stars)
- `refundExpired(taskId)` - Refund expired task

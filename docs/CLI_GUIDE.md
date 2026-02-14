# CLI Development Guide

## Overview

The CLI is built with Commander.js and integrates with Coinbase Agentic Wallet.

## Structure

```
apps/cli/
├── src/
│   ├── commands/     # CLI commands
│   └── lib/          # Wallet and API clients
```

## Commands

- `create` - Create a new task
- `submit` - Submit work for a task
- `accept` - Accept a submission
- `search` - Search available tasks
- `stats` - View worker statistics

## Wallet Integration

The CLI uses Coinbase Agentic Wallet (awal) for blockchain operations:

```typescript
const awal = new AwalClient();
const address = await awal.getAddress();
const txHash = await awal.callContract(contractAddress, 'createTask', args);
```

## API Client

tRPC client for API communication:

```typescript
const api = new ApiClient(process.env.API_URL);
const task = await api.getTask(taskId);
```

## USDC Approval Flow

Before creating a task, users must approve USDC spending:

```typescript
// 1. Approve USDC
await awal.approveUSDC(taskMarketAddress, rewardAmount);

// 2. Create task
await awal.callContract(taskMarketAddress, 'createTask', [taskId, duration]);
```

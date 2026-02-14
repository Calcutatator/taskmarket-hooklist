# Testing Guide

## Overview

We use Vitest for unit and integration tests, Playwright for E2E tests.

## Backend Tests

### Unit Tests

Test isolated logic without database:

```typescript
// apps/api/test/unit/env.test.ts
import { describe, it, expect } from 'vitest';

describe('Environment validation', () => {
  it('should validate required fields', () => {
    // Test implementation
  });
});
```

### Integration Tests

Test API endpoints with test database:

```typescript
// apps/api/test/integration/tasks.test.ts
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(async () => {
  // Setup test database
});

describe('Tasks API', () => {
  it('should create a task', async () => {
    // Test implementation
  });
});
```

## Frontend Tests

### Storybook Tests

Playwright tests against Storybook stories:

```bash
pnpm test:storybook
```

### E2E Tests

Full application tests:

```bash
pnpm test:e2e
```

## Smart Contract Tests

Forge tests in Solidity:

```bash
cd packages/contracts
forge test -vvv
```

## Running Tests

```bash
# All tests
make test

# Specific package
cd apps/api && pnpm test

# Watch mode
cd apps/api && pnpm test:watch
```

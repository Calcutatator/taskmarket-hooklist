# Testing Guide

## Overview

The project uses Vitest for unit tests in the backend, CLI, and shared package. Smart contract tests use Forge (Solidity). There are no E2E tests currently in the main test suite.

## Shared package tests

Location: `packages/shared/test/`

Run:

```bash
cd packages/shared
pnpm test
```

Tests cover `getAgentName` and `getAgentIdByName` in `lib/agentName.ts`:

- `getAgentName` returns null for null, undefined, NaN, Infinity
- Returns deterministic PascalCase names for valid numeric ids; accepts number, string, bigint
- Nearby ids get different names (variety); negative and large ids are normalized modulo N
- `getAgentIdByName` returns null for empty or unknown names
- Round-trip: `getAgentIdByName(getAgentName(id))` recovers the canonical id in `[0, N)` for a range of ids

Watch mode: `pnpm test:watch`

## CLI tests

Location: `apps/cli/test/unit/`

Run:

```bash
cd apps/cli
pnpm test
```

24 tests covering three modules:

### keystore.test.ts

Tests for `lib/keystore.ts`:
- `generateKeypair()` returns a valid address and private key
- `encryptPrivateKey` / `decryptPrivateKey` round-trip produces the original key
- `saveKeystore` / `loadKeystore` round-trip with a temp file
- `keystoreExists` returns false for missing file, true after save
- Encryption uses AES-256-GCM: wrong key produces an error on decryption

### signer.test.ts

Tests for `lib/signer.ts`:
- `fetchDeviceKey` calls the backend API with the correct token
- `signMessage` decrypts the key, signs, and returns the signature without retaining state
- Error propagation when the backend returns non-200

### x402.test.ts

Tests for `lib/x402.ts`:
- Round 1: request with no payment returns a parsed 402 response
- Round 2: signed payload is base64-encoded and sent in `PAYMENT-SIGNATURE` header
- Payment requirements are correctly extracted from the 402 body
- `EIP712` typed data is constructed correctly from payment requirements
- Error on facilitator rejection

Watch mode:

```bash
pnpm test:watch
```

## Backend unit tests

Location: `apps/backend/test/unit/`

Run:

```bash
cd apps/backend
pnpm test
```

Test files use Vitest. They test individual router logic using mock database contexts. Key test files:

| File | What it tests |
|------|--------------|
| `routers/devices.test.ts` | Device registration (13 tests): register, key fetch, status, revocation, HKDF derivation, token hash verification |
| `routers/health.test.ts` | Health check endpoint |
| `routers/tasks.test.ts` | Task creation input validation, list filtering |
| `routers/feedbacks.test.ts` | Feedback file content, hash integrity |

### Device router test highlights

The 13 device router tests verify:
- Successful device registration returns `deviceId`, `apiToken`, `deviceEncryptionKey`, `agentId`
- The returned DEK matches HKDF-SHA256(PLATFORM_MASTER_KEY, deviceId)
- The `apiToken` stored in the database is SHA-256 hashed (raw token not stored)
- Key fetch with correct token returns the DEK
- Key fetch with wrong token throws
- Key fetch for revoked device throws
- Idempotent re-registration returns existing `agentId`

### Feedback smoke tests

Verify that the feedback file content:
- Is deterministic (same inputs produce the same JSON)
- Has keys sorted alphabetically
- keccak256 hash matches what would be stored on-chain

## Smart contract tests

Location: `packages/contracts/test/`

Run:

```bash
cd packages/contracts
forge test -vvv
```

Forge tests are written in Solidity. Test file: `TaskMarket.t.sol`.

Key test scenarios:
- Task creation: USDC transfer into escrow, event emission, struct storage
- Claim mode: claim, submit, accept, stake return
- Claim mode: forfeit after expiry, stake transfer to fee recipient, reopen
- Pitch mode: pitch, select worker, submit, accept
- Bounty mode: multiple submissions, accept one
- Benchmark mode: proof submission, accept
- Expiry: refund after expiryTime, cannot refund accepted task
- Ratings: 0-100 scale, idempotent (cannot rate twice), reputation registry call
- Access control: `onlyServer` reverts for non-server callers, `onlyOwner` reverts for non-owner
- Fee calculation: correct split between worker and fee recipient

## Writing new tests

### Backend unit test pattern

```typescript
// apps/backend/test/unit/routers/my.test.ts
import { describe, it, expect, vi } from 'vitest';

describe('myRouter', () => {
  it('should do something', async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: '1' }]),
    };

    // ... test the router procedure with mock ctx
    expect(result).toEqual({ id: '1' });
  });
});
```

### CLI unit test pattern

```typescript
// apps/cli/test/unit/myModule.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { myFunction } from '../../src/lib/myModule.js';

vi.mock('../../src/lib/api.js', () => ({
  apiGet: vi.fn(),
}));

describe('myFunction', () => {
  it('returns expected result', async () => {
    // mock API response, call function, assert
  });
});
```

### Forge test pattern

```solidity
// packages/contracts/test/MyContract.t.sol
pragma solidity ^0.8.24;
import "forge-std/Test.sol";
import "../src/MyContract.sol";

contract MyContractTest is Test {
    MyContract target;

    function setUp() public {
        target = new MyContract(...);
    }

    function test_SomeBehavior() public {
        // arrange
        // act
        // assert with assertEq, assertTrue, etc.
    }

    function test_RevertWhen_Unauthorized() public {
        vm.expectRevert("Not authorized server");
        target.someFunction();
    }
}
```

## Running all tests

```bash
make test
```

This runs CLI tests, backend tests, and contract tests in sequence.

## Skill conformance

Run the platform-to-skill drift gate with:

```bash
make skill-conformance
```

The gate verifies:

- runtime modes, statuses, pending actions, submission windows, standard X402 fees, and the pitch-selection signature against the canonical skill;
- every documented task command against the live Commander command tree;
- every documented raw REST route against generated OpenAPI and every generated task or evaluation operation against the raw REST reference;
- recursive Markdown link closure and exact package-manifest contents;
- backend and web publication paths resolve to the canonical package;
- clean and upgrade HTTP installations produce the exact package, including removal of files deleted from the manifest; and
- known stale public claims about statuses, fees, rating identity, and one-file installation remain absent.

GitHub Actions runs the same Makefile target as the independent `skill-conformance` job. When it fails, update the implementation and canonical skill together; do not weaken the assertion or add copied publication files.

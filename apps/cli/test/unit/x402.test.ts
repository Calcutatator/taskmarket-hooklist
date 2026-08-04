import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Keystore } from '../../src/lib/keystore.js';

// vi.hoisted runs before module mocks — use it to define shared values
const hoisted = vi.hoisted(() => {
  const { randomBytes: rb } = require('crypto') as typeof import('crypto');
  const dekBytes = rb(32).toString('hex');
  return { dek: dekBytes };
});

const dek = hoisted.dek;

// vi.mock is hoisted by vitest — factory must only reference values from vi.hoisted or literals
vi.mock('../../src/lib/keystore.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const { generateKeypair: gkp, encryptPrivateKey: ekp } = actual as {
    generateKeypair: () => { privateKey: string; address: string };
    encryptPrivateKey: (dek: string, key: string) => string;
  };
  const { dek: testDek } = hoisted;
  const { privateKey, address } = gkp();
  const mockKeystoreValue: Keystore = {
    encryptedKey: ekp(testDek, privateKey),
    walletAddress: address,
    deviceId: 'test-device-id',
    apiToken: 'test-api-token',
  };
  return {
    ...actual,
    loadKeystore: vi.fn().mockResolvedValue(mockKeystoreValue),
  };
});

import { IDEMPOTENCY_KEY_HEADER } from '@taskmarket/shared';

import { x402Post } from '../../src/lib/x402.js';
import { ApiError } from '../../src/lib/api.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const PAYMENT_REQUIREMENTS = {
  resource: { url: 'http://localhost:3000/api/tasks', description: 'Create task' },
  accepts: [
    {
      scheme: 'exact',
      network: 'eip155:84532',
      amount: '1000000',
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      payTo: '0x0000000000000000000000000000000000000001',
      maxTimeoutSeconds: 300,
      extra: {
        eip712: {
          domain: {
            name: 'USDC',
            version: '2',
            chainId: 84532,
            verifyingContract: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
          },
          types: {
            TransferWithAuthorization: [
              { name: 'from', type: 'address' },
              { name: 'to', type: 'address' },
              { name: 'value', type: 'uint256' },
              { name: 'validAfter', type: 'uint256' },
              { name: 'validBefore', type: 'uint256' },
              { name: 'nonce', type: 'bytes32' },
            ],
          },
          primaryType: 'TransferWithAuthorization',
        },
      },
    },
  ],
};

describe('x402Post', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns response body immediately on 200 (no 402 flow)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, taskId: '0xabc' }),
    });

    const result = await x402Post('/api/tasks', { description: 'test' });
    expect(result).toEqual({ success: true, taskId: '0xabc' });
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('performs two-round flow on 402 and returns success result', async () => {
    // Round 1: 402 with payment requirements
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 402,
      json: async () => PAYMENT_REQUIREMENTS,
    });
    // fetchDeviceKey call from signer
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ deviceEncryptionKey: dek }),
    });
    // Round 2: success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, taskId: '0xabc' }),
    });

    const result = await x402Post('/api/tasks', { description: 'test' });

    expect(result).toEqual({ success: true, taskId: '0xabc' });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('throws when round 1 returns a non-402 error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    await expect(x402Post('/api/tasks', {})).rejects.toThrow('500');
  });

  // Code review finding: submit.ts (and any other future x402Post caller past a
  // gated free-then-paid endpoint) needs the real HTTP status structurally, not just
  // embedded as text, to add it to the CLI's standard JSON error envelope -- see
  // apps/cli/src/lib/api.ts's ApiError and apps/cli/src/index.ts's top-level catch.
  it('throws ApiError with the real status when round 1 returns a non-402 error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () =>
        '{"error":"This task has reached its maximum number of submissions from this worker."}',
    });

    const error = await x402Post('/api/tasks', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(429);
  });

  it('throws ApiError with the real status when round 2 (post-payment) returns non-200', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 402,
      json: async () => PAYMENT_REQUIREMENTS,
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ deviceEncryptionKey: dek }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Settlement failed' }),
    });

    const error = await x402Post('/api/tasks', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(500);
  });

  it('throws when round 2 returns non-200', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 402,
      json: async () => PAYMENT_REQUIREMENTS,
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ deviceEncryptionKey: dek }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 402,
      json: async () => ({ error: 'Settlement failed' }),
    });

    await expect(x402Post('/api/tasks', {})).rejects.toThrow();
  });

  it('throws when payment requirements have no accepts', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 402,
      json: async () => ({ resource: {}, accepts: [] }),
    });

    await expect(x402Post('/api/tasks', {})).rejects.toThrow('No payment methods accepted');
  });

  it('round 2 request includes PAYMENT-SIGNATURE header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 402,
      json: async () => PAYMENT_REQUIREMENTS,
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ deviceEncryptionKey: dek }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });

    await x402Post('/api/tasks', {});

    const round2Call = mockFetch.mock.calls[2];
    const headers = round2Call[1].headers as Record<string, string>;
    expect(headers['PAYMENT-SIGNATURE']).toBeDefined();
    expect(typeof headers['PAYMENT-SIGNATURE']).toBe('string');
  });

  // Discovery and the paid retry are one logical write. A fresh key on round 2 would present the
  // paid round as a new operation, which is the mistake the key exists to prevent.
  it('sends one idempotency key across both rounds of the paid exchange', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 402,
      json: async () => PAYMENT_REQUIREMENTS,
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ deviceEncryptionKey: dek }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });

    await x402Post('/api/tasks', {});

    const round1 = mockFetch.mock.calls[0][1].headers as Record<string, string>;
    const round2 = mockFetch.mock.calls[2][1].headers as Record<string, string>;
    expect(round1[IDEMPOTENCY_KEY_HEADER]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(round2[IDEMPOTENCY_KEY_HEADER]).toBe(round1[IDEMPOTENCY_KEY_HEADER]);
  });

  it('reuses a caller-supplied key so a retry of one operation is not a second operation', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });

    await x402Post('/api/tasks', {}, { idempotencyKey: 'key-for-one-operation' });
    await x402Post('/api/tasks', {}, { idempotencyKey: 'key-for-one-operation' });

    const first = mockFetch.mock.calls[0][1].headers as Record<string, string>;
    const second = mockFetch.mock.calls[1][1].headers as Record<string, string>;
    expect(first[IDEMPOTENCY_KEY_HEADER]).toBe('key-for-one-operation');
    expect(second[IDEMPOTENCY_KEY_HEADER]).toBe('key-for-one-operation');
  });

  it('gives separate operations separate keys', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });

    await x402Post('/api/tasks', {});
    await x402Post('/api/tasks', {});

    const first = mockFetch.mock.calls[0][1].headers as Record<string, string>;
    const second = mockFetch.mock.calls[1][1].headers as Record<string, string>;
    expect(second[IDEMPOTENCY_KEY_HEADER]).not.toBe(first[IDEMPOTENCY_KEY_HEADER]);
  });
});

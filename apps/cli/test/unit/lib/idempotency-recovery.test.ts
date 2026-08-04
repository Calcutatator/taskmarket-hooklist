// A relayed write that fails must leave the operator holding the key it was sent under: the
// intent id is minted by the backend and only reaches the caller in the response the failure
// destroyed, so the client-chosen key is the only handle that survives. These tests pin that the
// key reaches the CLI's JSON envelope from every transport path, that a caller-supplied key
// round-trips, and that a plain re-run is a new operation rather than a silent retry.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { Keystore } from '../../../src/lib/keystore.js';

const hoisted = vi.hoisted(() => {
  const { randomBytes: rb } = require('crypto') as typeof import('crypto');
  return { dek: rb(32).toString('hex') };
});

const dek = hoisted.dek;

vi.mock('../../../src/lib/keystore.js', async (importOriginal) => {
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
  return { ...actual, loadKeystore: vi.fn().mockResolvedValue(mockKeystoreValue) };
});

import { IDEMPOTENCY_KEY_HEADER } from '@taskmarket/shared';

import { ApiError, apiDelete, apiGet, apiPost } from '../../../src/lib/api.js';
import {
  getLastIdempotencyKey,
  resetIdempotencyState,
  resolveIdempotencyKey,
} from '../../../src/lib/idempotency.js';
import { printError, printResult } from '../../../src/lib/output.js';
import { x402Post } from '../../../src/lib/x402.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function headerFor(callIndex: number): string | undefined {
  const init = mockFetch.mock.calls[callIndex][1] as { headers: Record<string, string> };
  return init.headers[IDEMPOTENCY_KEY_HEADER];
}

beforeEach(() => {
  mockFetch.mockReset();
  resetIdempotencyState();
});

describe('the key a failed write was sent under reaches the error', () => {
  it('apiPost carries it on the thrown ApiError and it matches the header sent', async () => {
    mockFetch.mockResolvedValue(jsonResponse(500, { error: 'ServerTransactionPendingError' }));

    const caught = (await apiPost('/api/tasks', {}).catch((e: unknown) => e)) as ApiError;

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught.idempotencyKey).toMatch(UUID_RE);
    expect(caught.idempotencyKey).toBe(headerFor(0));
  });

  it('apiDelete carries it on the thrown ApiError and it matches the header sent', async () => {
    mockFetch.mockResolvedValue(jsonResponse(500, { error: 'boom' }));

    const caught = (await apiDelete('/api/tasks/0xabc').catch((e: unknown) => e)) as ApiError;

    expect(caught.idempotencyKey).toMatch(UUID_RE);
    expect(caught.idempotencyKey).toBe(headerFor(0));
  });

  it('x402Post carries it when round 1 fails before any payment', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'rate limited' });

    const caught = (await x402Post('/api/tasks', {}).catch((e: unknown) => e)) as ApiError;

    expect(caught.status).toBe(429);
    expect(caught.idempotencyKey).toBe(headerFor(0));
  });

  // The case the key exists for: the payment settled in round 2, so the caller has been charged
  // for a write whose outcome the response no longer tells them.
  it('x402Post carries it when round 2 fails after payment settled, and it is the round 1 key', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 402,
      json: async () => PAYMENT_REQUIREMENTS,
    });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ deviceEncryptionKey: dek }) });
    mockFetch.mockResolvedValueOnce(jsonResponse(500, { error: 'ServerTransactionPendingError' }));

    const caught = (await x402Post('/api/tasks', {}).catch((e: unknown) => e)) as ApiError;

    expect(caught.status).toBe(500);
    expect(caught.idempotencyKey).toMatch(UUID_RE);
    // One key for the whole exchange: the paid round must not look like a second operation.
    expect(caught.idempotencyKey).toBe(headerFor(0));
    expect(caught.idempotencyKey).toBe(headerFor(2));
  });

  it('a GET failure has no key, because a read is not an operation to recover', async () => {
    mockFetch.mockResolvedValue(jsonResponse(500, { error: 'internal' }));

    const caught = (await apiGet('/api/tasks/0xabc').catch((e: unknown) => e)) as ApiError;

    expect(caught.idempotencyKey).toBeUndefined();
    expect(getLastIdempotencyKey()).toBeUndefined();
  });
});

describe('a caller-supplied key round-trips', () => {
  it('apiPost sends the supplied key and returns it on failure rather than minting one', async () => {
    mockFetch.mockResolvedValue(jsonResponse(500, { error: 'boom' }));

    const caught = (await apiPost('/api/tasks', {}, { idempotencyKey: 'operator-chosen' }).catch(
      (e: unknown) => e
    )) as ApiError;

    expect(headerFor(0)).toBe('operator-chosen');
    expect(caught.idempotencyKey).toBe('operator-chosen');
  });

  it('x402Post presents the supplied key on both rounds', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 402,
      json: async () => PAYMENT_REQUIREMENTS,
    });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ deviceEncryptionKey: dek }) });
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { success: true }));

    await x402Post('/api/tasks', {}, { idempotencyKey: 'operator-chosen' });

    expect(headerFor(0)).toBe('operator-chosen');
    expect(headerFor(2)).toBe('operator-chosen');
  });

  it('TASKMARKET_IDEMPOTENCY_KEY supplies the key for the next write', async () => {
    resetIdempotencyState('from-environment');
    mockFetch.mockResolvedValue(jsonResponse(500, { error: 'boom' }));

    const caught = (await apiPost('/api/tasks', {}).catch((e: unknown) => e)) as ApiError;

    expect(headerFor(0)).toBe('from-environment');
    expect(caught.idempotencyKey).toBe('from-environment');
  });

  // Re-presenting is one deliberate act. A key that stayed in force would collapse every later
  // write of a multi-write command into the first one's identity.
  it('an environment key is consumed once, so a second write in the same process mints a fresh one', () => {
    resetIdempotencyState('from-environment');

    expect(resolveIdempotencyKey()).toBe('from-environment');
    expect(resolveIdempotencyKey()).toMatch(UUID_RE);
  });

  it('an explicit key always wins over the environment', () => {
    resetIdempotencyState('from-environment');

    expect(resolveIdempotencyKey('explicit')).toBe('explicit');
  });
});

describe('a plain re-run is a new operation, not a retry', () => {
  it('two writes with no key supplied are sent under different keys', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { ok: true }));

    await apiPost('/api/tasks', {});
    await apiPost('/api/tasks', {});

    expect(headerFor(0)).not.toBe(headerFor(1));
  });
});

describe('the CLI envelope', () => {
  let stderr: ReturnType<typeof vi.spyOn>;
  let stdout: ReturnType<typeof vi.spyOn>;
  let exit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
  });

  afterEach(() => {
    stderr.mockRestore();
    stdout.mockRestore();
    exit.mockRestore();
  });

  it('printError surfaces the key of the write that just failed, without the command passing it', async () => {
    mockFetch.mockResolvedValue(jsonResponse(500, { error: 'boom' }));
    const caught = (await apiPost('/api/tasks', {}).catch((e: unknown) => e)) as ApiError;

    expect(() => printError(caught.message)).toThrow('exit');

    const written = JSON.parse((stderr.mock.calls[0][0] as string).trim()) as Record<
      string,
      unknown
    >;
    expect(written.ok).toBe(false);
    expect(written.idempotencyKey).toBe(caught.idempotencyKey);
  });

  it('printError omits the key entirely when the command attempted no write', () => {
    expect(() => printError('not a write at all')).toThrow('exit');

    const written = JSON.parse((stderr.mock.calls[0][0] as string).trim()) as Record<
      string,
      unknown
    >;
    expect(written).toEqual({ ok: false, error: 'not a write at all' });
  });

  it('printResult reports the key beside data, leaving the backend payload untouched', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { taskId: '0xabc' }));
    await apiPost('/api/tasks', {});

    printResult({ taskId: '0xabc' });

    const written = JSON.parse(stdout.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(written.data).toEqual({ taskId: '0xabc' });
    expect(written.idempotencyKey).toBe(getLastIdempotencyKey());
  });

  it('printResult on a read-only command emits the envelope unchanged', () => {
    printResult({ tasks: [] });

    expect(JSON.parse(stdout.mock.calls[0][0] as string)).toEqual({
      ok: true,
      data: { tasks: [] },
    });
  });
});

// A relayed write must leave the operator holding the key it was sent under: the intent id is
// minted by the backend and only reaches the caller in the response a failure destroys, so the
// client-chosen key is the only handle that survives. These tests pin that the key reaches the
// CLI's JSON envelope from every transport path and from both outcomes, that it always names the
// write the envelope describes, that a caller-supplied key round-trips, and that a plain re-run
// is a new operation rather than a silent retry.
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

import { ApiError, apiDelete, apiGet, apiPost, withErrorContext } from '../../../src/lib/api.js';
import {
  idempotencyKeyForError,
  resetIdempotencyState,
  resolveIdempotencyKey,
} from '../../../src/lib/idempotency.js';
import { printError, printResult, renderFailure } from '../../../src/lib/output.js';
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
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
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
      text: async () => JSON.stringify(PAYMENT_REQUIREMENTS),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ deviceEncryptionKey: dek }),
      text: async () => JSON.stringify({ deviceEncryptionKey: dek }),
    });
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
  });

  // The failures with no response behind them: a dropped connection, a signing error, a payment
  // the server would not quote for. There is no `ApiError` to carry a key, so the key is attached
  // to whatever was thrown -- and it survives being wrapped for context on the way out.
  it('a failure with no ApiError still carries the key, through a context wrapper', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

    const caught = await apiPost('/api/tasks', {}).catch((e: unknown) => e);

    expect(caught).not.toBeInstanceOf(ApiError);
    expect(idempotencyKeyForError(caught)).toBe(headerFor(0));
    expect(idempotencyKeyForError(withErrorContext(caught, 'create failed'))).toBe(headerFor(0));
  });
});

describe('the key a successful write was sent under comes back with the result', () => {
  it('apiPost returns it beside the payload, and it matches the header sent', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { taskId: '0xabc' }));

    const { data, idempotencyKey } = await apiPost('/api/tasks', {});

    expect(data).toEqual({ taskId: '0xabc' });
    expect(idempotencyKey).toBe(headerFor(0));
  });

  it('x402Post returns it after a paid round, and it is the key round 1 presented', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 402,
      json: async () => PAYMENT_REQUIREMENTS,
      text: async () => JSON.stringify(PAYMENT_REQUIREMENTS),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ deviceEncryptionKey: dek }),
      text: async () => JSON.stringify({ deviceEncryptionKey: dek }),
    });
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { success: true }));

    const { idempotencyKey } = await x402Post('/api/tasks', {});

    expect(idempotencyKey).toBe(headerFor(0));
    expect(idempotencyKey).toBe(headerFor(2));
  });

  it('apiDelete returns it beside the payload', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { deleted: true }));

    const { data, idempotencyKey } = await apiDelete('/api/tasks/0xabc');

    expect(data).toEqual({ deleted: true });
    expect(idempotencyKey).toBe(headerFor(0));
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
      text: async () => JSON.stringify(PAYMENT_REQUIREMENTS),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ deviceEncryptionKey: dek }),
      text: async () => JSON.stringify({ deviceEncryptionKey: dek }),
    });
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

  beforeEach(() => {
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.exitCode = undefined;
  });

  afterEach(() => {
    stderr.mockRestore();
    stdout.mockRestore();
    process.exitCode = undefined;
  });

  function failure(): Record<string, unknown> {
    return JSON.parse((stderr.mock.calls[0][0] as string).trim()) as Record<string, unknown>;
  }

  it('renderFailure reports the key the failed write carried, without the command passing it', async () => {
    mockFetch.mockResolvedValue(jsonResponse(500, { error: 'boom' }));

    const caught = (await apiPost('/api/tasks', {}).catch((e: unknown) => e)) as ApiError;
    renderFailure(caught);

    expect(process.exitCode).toBe(1);
    expect(failure().ok).toBe(false);
    expect(failure().idempotencyKey).toBe(caught.idempotencyKey);
  });

  it('printError omits the key entirely, because a message the CLI composed named no write', () => {
    printError('not a write at all');

    expect(process.exitCode).toBe(1);
    expect(failure()).toEqual({ ok: false, error: 'not a write at all' });
  });

  it('printResult reports the key beside data, leaving the backend payload untouched', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { taskId: '0xabc' }));

    const { data, idempotencyKey } = await apiPost('/api/tasks', {});
    printResult(data, { idempotencyKey });

    const written = JSON.parse(stdout.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(written.data).toEqual({ taskId: '0xabc' });
    expect(written.idempotencyKey).toBe(headerFor(0));
  });

  it('printResult on a read-only command emits the envelope unchanged', () => {
    printResult({ tasks: [] });

    expect(JSON.parse(stdout.mock.calls[0][0] as string)).toEqual({
      ok: true,
      data: { tasks: [] },
    });
  });
});

// The reason the key is returned and attached rather than looked up: none of these arrangements
// leaves a "current write" for anything to read. A batch stashes a failure and keeps writing; a
// poll loop writes once a turn forever; concurrent branches interleave. In every one, the answer
// to "which write does this report name" is carried by the thing being reported.
describe('a report names its own write, whatever ran in between', () => {
  let stderr: ReturnType<typeof vi.spyOn>;
  let stdout: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.exitCode = undefined;
  });

  afterEach(() => {
    stderr.mockRestore();
    stdout.mockRestore();
    process.exitCode = undefined;
  });

  function failure(): Record<string, unknown> {
    return JSON.parse((stderr.mock.calls[0][0] as string).trim()) as Record<string, unknown>;
  }

  // The shape `task reject-all-submissions` has, and the case that motivated all of this: the
  // failure is rendered only after every later write has finished.
  it('a batch whose second of three writes fails reports the second key, not the last', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    mockFetch.mockResolvedValueOnce(jsonResponse(500, { error: 'ServerTransactionPendingError' }));
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const failures: unknown[] = [];
    for (const path of ['/api/a', '/api/b', '/api/c']) {
      try {
        await apiPost(path, {});
      } catch (err) {
        failures.push(err);
      }
    }
    renderFailure(withErrorContext(failures[0], '1 of 3 rejection(s) failed'));

    expect(failure().idempotencyKey).toBe(headerFor(1));
    expect(failure().idempotencyKey).not.toBe(headerFor(2));
  });

  // Same batch, but the failure has no response behind it, so there is no `ApiError` to carry the
  // key. This is the case a "last write" answer would have got wrong even on the failure side.
  it('covers a batch failure with no HTTP response behind it, such as a dropped connection', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const failures: unknown[] = [];
    for (const path of ['/api/a', '/api/b', '/api/c']) {
      try {
        await apiPost(path, {});
      } catch (err) {
        failures.push(err);
      }
    }
    expect(failures[0]).not.toBeInstanceOf(ApiError);
    renderFailure(failures[0]);

    expect(failure().idempotencyKey).toBe(headerFor(1));
  });

  // What the daemon's heartbeat does: write, report, sleep, forever.
  it('a loop reports each turn own write, however many turns came before', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { ok: true }));

    for (let turn = 0; turn < 3; turn++) {
      const { idempotencyKey } = await apiPost('/trpc/xmtp.heartbeat', {});
      printResult({ event: 'xmtp.heartbeat' }, { idempotencyKey });
    }

    for (let turn = 0; turn < 3; turn++) {
      const envelope = JSON.parse(stdout.mock.calls[turn][0] as string) as Record<string, unknown>;
      expect(envelope.idempotencyKey).toBe(headerFor(turn));
    }
  });

  // What `task submit` does with its per-file uploads. Nothing coordinates the branches.
  it('concurrent writes each report their own key', async () => {
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    mockFetch.mockReturnValueOnce(gate.then(() => jsonResponse(500, { error: 'A failed' })));
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const a = apiPost('/api/a', {}).catch((e: unknown) => e);
    await new Promise((resolve) => setImmediate(resolve));
    const b = apiPost('/api/b', {});
    await new Promise((resolve) => setImmediate(resolve));

    releaseFirst();
    const errA = (await a) as ApiError;
    const { idempotencyKey: keyB } = await b;

    expect(errA.idempotencyKey).toBe(headerFor(0));
    expect(keyB).toBe(headerFor(1));
    expect(errA.idempotencyKey).not.toBe(keyB);
  });
});

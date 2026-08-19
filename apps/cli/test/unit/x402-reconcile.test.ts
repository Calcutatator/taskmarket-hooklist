// Verifies: ADR-0092
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getChainId: vi.fn(),
  readContract: vi.fn(),
  getTransactionReceipt: vi.fn(),
}));

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      getChainId: mocks.getChainId,
      readContract: mocks.readContract,
      getTransactionReceipt: mocks.getTransactionReceipt,
    })),
  };
});

import { reserveX402Payment, transitionX402Payment } from '../../src/lib/x402-journal.js';
import { reconcileX402Payment } from '../../src/lib/x402-reconcile.js';
import type { X402PolicyAuthorization } from '../../src/lib/x402-policy.js';

const ASSET = '0x0000000000000000000000000000000000000001';
const PAY_TO = '0x0000000000000000000000000000000000000002';
const PAYER = '0x0000000000000000000000000000000000000003';

function authorization(scheme: 'exact' | 'upto'): X402PolicyAuthorization {
  const payment = {
    scheme,
    network: 'eip155:8453',
    asset: ASSET,
    payTo: PAY_TO,
    maxPerPayment: '100',
    spendWindow: { seconds: 3600, max: '100' },
  } as const;
  return {
    rule: {
      id: 'test',
      enabled: true,
      priority: 0,
      origin: 'https://api.example.com',
      pathPrefix: '/',
      methods: ['GET'],
      unattended: true,
      allowPrivateNetwork: false,
      maxAuthorizationSeconds: 300,
      payments: [payment],
    },
    payment,
    requirement: {
      ...payment,
      amount: '100',
      maxTimeoutSeconds: 300,
    },
    windowStartedAt: new Date(Date.now() - 3_600_000).toISOString(),
  };
}

describe('x402 payment reconciliation', () => {
  let temporaryDirectory: string;
  let previousPolicyPath: string | undefined;
  let previousJournalPath: string | undefined;
  let previousRpc: string | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.getChainId.mockResolvedValue(8453);
    mocks.getTransactionReceipt.mockRejectedValue(new Error('not found'));
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'x402-reconcile-test-'));
    previousPolicyPath = process.env['TASKMARKET_X402_POLICY_PATH'];
    previousJournalPath = process.env['TASKMARKET_X402_JOURNAL_PATH'];
    previousRpc = process.env['TEST_X402_RPC_URL'];
    process.env['TASKMARKET_X402_POLICY_PATH'] = path.join(temporaryDirectory, 'policy.json');
    process.env['TASKMARKET_X402_JOURNAL_PATH'] = path.join(temporaryDirectory, 'journal.jsonl');
    process.env['TEST_X402_RPC_URL'] = 'https://rpc.example.com';
    await fs.writeFile(
      process.env['TASKMARKET_X402_POLICY_PATH'],
      JSON.stringify({
        version: 1,
        networks: { 'eip155:8453': { rpcUrlEnv: 'TEST_X402_RPC_URL' } },
        rules: [],
      }),
      { mode: 0o600 }
    );
  });

  afterEach(async () => {
    for (const [name, value] of [
      ['TASKMARKET_X402_POLICY_PATH', previousPolicyPath],
      ['TASKMARKET_X402_JOURNAL_PATH', previousJournalPath],
      ['TEST_X402_RPC_URL', previousRpc],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  async function record(scheme: 'exact' | 'upto') {
    return reserveX402Payment({
      authorization: authorization(scheme),
      url: new URL('https://api.example.com'),
      method: 'GET',
      requestHash: randomHash(),
      payer: PAYER,
    });
  }

  function randomHash() {
    return Math.random().toString(16).slice(2);
  }

  async function markUnknown(
    id: string,
    details: {
      authorizationKind: 'eip3009' | 'permit2';
      nonce: string;
      authorizationExpiresAt: string;
    }
  ) {
    await transitionX402Payment(id, { state: 'ready', ...details });
    await transitionX402Payment(id, { state: 'dispatched' });
    await transitionX402Payment(id, { state: 'unknown' });
  }

  it('releases a prepared payment that was never dispatched', async () => {
    const prepared = await record('exact');
    await transitionX402Payment(prepared.id, {
      state: 'ready',
      authorizationKind: 'eip3009',
      nonce: `0x${'11'.repeat(32)}`,
      authorizationExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const result = await reconcileX402Payment(prepared.id);
    expect(result.state).toBe('failed_before_dispatch');
  });

  it('marks a consumed exact authorization as settled', async () => {
    mocks.readContract.mockResolvedValue(true);
    const pending = await record('exact');
    await markUnknown(pending.id, {
      authorizationKind: 'eip3009',
      nonce: `0x${'22'.repeat(32)}`,
      authorizationExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const result = await reconcileX402Payment(pending.id);
    expect(result).toMatchObject({ state: 'settled', settledAmount: '100' });
  });

  it('releases an expired unused authorization', async () => {
    mocks.readContract.mockResolvedValue(false);
    const pending = await record('exact');
    await markUnknown(pending.id, {
      authorizationKind: 'eip3009',
      nonce: `0x${'33'.repeat(32)}`,
      authorizationExpiresAt: new Date(Date.now() - 1_000).toISOString(),
    });
    const result = await reconcileX402Payment(pending.id);
    expect(result).toMatchObject({ state: 'expired_unspent', settledAmount: '0' });
  });

  it('keeps a consumed upto authorization at the maximum when amount is unknown', async () => {
    mocks.readContract.mockResolvedValue(1n << 7n);
    const pending = await record('upto');
    await markUnknown(pending.id, {
      authorizationKind: 'permit2',
      nonce: '7',
      authorizationExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const result = await reconcileX402Payment(pending.id);
    expect(result.state).toBe('settled_amount_unknown');
    expect(result.settledAmount).toBeUndefined();
  });
});

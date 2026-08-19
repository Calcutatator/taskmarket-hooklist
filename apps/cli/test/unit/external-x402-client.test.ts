// Verifies: ADR-0092
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  signTypedData: vi.fn().mockResolvedValue(`0x${'11'.repeat(65)}`),
  ensurePermit2Approval: vi.fn().mockResolvedValue({
    mode: 'existing',
    allowance: '1000',
    targetAllowance: '1000',
  }),
}));

vi.mock('../../src/lib/keystore.js', () => ({
  loadKeystore: vi.fn().mockResolvedValue({
    encryptedKey: 'encrypted',
    walletAddress: '0x0000000000000000000000000000000000000003',
    deviceId: 'device',
    apiToken: 'token',
    agentId: null,
  }),
}));

vi.mock('../../src/lib/signer.js', () => ({
  createWalletAccountFromKeystore: vi.fn().mockResolvedValue({
    address: '0x0000000000000000000000000000000000000003',
    signTypedData: mocks.signTypedData,
    signTransaction: vi.fn(),
  }),
}));

vi.mock('../../src/lib/x402-permit2.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/x402-permit2.js')>();
  return { ...actual, ensurePermit2Approval: mocks.ensurePermit2Approval };
});

import { executeExternalX402Request } from '../../src/lib/external-x402-client.js';
import { getX402Payment } from '../../src/lib/x402-journal.js';

const RESOURCE = 'https://127.0.0.1/paid';
const ASSET = '0x0000000000000000000000000000000000000001';
const PAY_TO = '0x0000000000000000000000000000000000000002';
const FACILITATOR = '0x0000000000000000000000000000000000000004';

function header(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64');
}

function challenge(scheme: 'exact' | 'upto', amount = '100') {
  return {
    x402Version: 2,
    error: 'Payment required',
    resource: { url: RESOURCE, description: 'Paid test', mimeType: 'application/json' },
    accepts: [
      {
        scheme,
        network: 'eip155:8453',
        amount,
        asset: ASSET,
        payTo: PAY_TO,
        maxTimeoutSeconds: 300,
        extra:
          scheme === 'upto'
            ? { facilitatorAddress: FACILITATOR }
            : { name: 'USDC', version: '2' },
      },
    ],
  };
}

describe('external x402 client', () => {
  let temporaryDirectory: string;
  let previousPolicyPath: string | undefined;
  let previousJournalPath: string | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.ensurePermit2Approval.mockResolvedValue({
      mode: 'existing',
      allowance: '1000',
      targetAllowance: '1000',
    });
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'external-x402-test-'));
    previousPolicyPath = process.env['TASKMARKET_X402_POLICY_PATH'];
    previousJournalPath = process.env['TASKMARKET_X402_JOURNAL_PATH'];
    process.env['TASKMARKET_X402_POLICY_PATH'] = path.join(temporaryDirectory, 'policy.json');
    process.env['TASKMARKET_X402_JOURNAL_PATH'] = path.join(temporaryDirectory, 'journal.jsonl');
  });

  afterEach(async () => {
    if (previousPolicyPath === undefined) delete process.env['TASKMARKET_X402_POLICY_PATH'];
    else process.env['TASKMARKET_X402_POLICY_PATH'] = previousPolicyPath;
    if (previousJournalPath === undefined) delete process.env['TASKMARKET_X402_JOURNAL_PATH'];
    else process.env['TASKMARKET_X402_JOURNAL_PATH'] = previousJournalPath;
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  async function writePolicy(scheme: 'exact' | 'upto', maximum = '1000') {
    await fs.writeFile(
      process.env['TASKMARKET_X402_POLICY_PATH']!,
      JSON.stringify({
        version: 1,
        networks: { 'eip155:8453': { rpcUrlEnv: 'TEST_RPC_URL' } },
        rules: [
          {
            id: 'external-test',
            enabled: true,
            priority: 10,
            origin: 'https://127.0.0.1',
            pathPrefix: '/',
            methods: ['GET', 'POST'],
            unattended: true,
            allowPrivateNetwork: true,
            maxAuthorizationSeconds: 300,
            payments: [
              {
                scheme,
                network: 'eip155:8453',
                asset: ASSET,
                payTo: PAY_TO,
                maxPerPayment: maximum,
                spendWindow: { seconds: 3600, max: maximum },
                ...(scheme === 'upto'
                  ? {
                      permit2: {
                        allowSponsoredApproval: true,
                        allowDirectApproval: false,
                        allowUnattendedDirectApproval: false,
                      },
                    }
                  : {}),
              },
            ],
          },
        ],
      }),
      { mode: 0o600 }
    );
  }

  it('pays an exact EIP-3009 challenge and journals the settled amount', async () => {
    await writePolicy('exact');
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(challenge('exact')), {
          status: 402,
          headers: { 'payment-required': header(challenge('exact')) },
        })
      )
      .mockImplementationOnce(async (request: Request) => {
        expect(request.headers.get('payment-signature')).toBeTruthy();
        return new Response(JSON.stringify({ result: 'ok' }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'payment-response': header({
              success: true,
              transaction: `0x${'22'.repeat(32)}`,
              network: 'eip155:8453',
              payer: '0x0000000000000000000000000000000000000003',
            }),
          },
        });
      });

    const result = await executeExternalX402Request({
      rawUrl: RESOURCE,
      nonInteractive: true,
      fetchImpl,
    });
    expect(result.payment).toMatchObject({
      state: 'settled',
      scheme: 'exact',
      authorizedAmount: '100',
      settledAmount: '100',
    });
    expect(result.response.body).toEqual({ result: 'ok' });
    expect(mocks.signTypedData).toHaveBeenCalledOnce();
  });

  it('replays byte-identical JSON on the paid POST round', async () => {
    await writePolicy('exact');
    const body = '{ "prompt": "preserve whitespace" }';
    const observedBodies: string[] = [];
    const fetchImpl = vi.fn().mockImplementation(async (request: Request) => {
      observedBodies.push(await request.text());
      if (observedBodies.length === 1) {
        return new Response(JSON.stringify(challenge('exact')), {
          status: 402,
          headers: { 'payment-required': header(challenge('exact')) },
        });
      }
      return new Response(JSON.stringify({ result: 'ok' }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'payment-response': header({
            success: true,
            transaction: `0x${'55'.repeat(32)}`,
            network: 'eip155:8453',
          }),
        },
      });
    });
    await executeExternalX402Request({
      rawUrl: RESOURCE,
      method: 'POST',
      json: body,
      nonInteractive: true,
      fetchImpl,
    });
    expect(observedBodies).toEqual([body, body]);
  });

  it('pays an upto challenge and records the actual settlement', async () => {
    await writePolicy('upto');
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(challenge('upto')), {
          status: 402,
          headers: { 'payment-required': header(challenge('upto')) },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: 'usage billed' }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'payment-response': header({
              success: true,
              transaction: `0x${'33'.repeat(32)}`,
              network: 'eip155:8453',
              amount: '37',
            }),
          },
        })
      );
    const result = await executeExternalX402Request({
      rawUrl: RESOURCE,
      nonInteractive: true,
      fetchImpl,
    });
    expect(result.payment).toMatchObject({
      state: 'settled',
      scheme: 'upto',
      authorizedAmount: '100',
      settledAmount: '37',
      authorizationKind: 'permit2',
    });
    expect(mocks.ensurePermit2Approval).toHaveBeenCalledOnce();
  });

  it('keeps the full maximum reserved after a lost paid response', async () => {
    await writePolicy('exact');
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(challenge('exact')), {
          status: 402,
          headers: { 'payment-required': header(challenge('exact')) },
        })
      )
      .mockRejectedValueOnce(new Error('socket closed'));
    const error = await executeExternalX402Request({
      rawUrl: RESOURCE,
      nonInteractive: true,
      fetchImpl,
    }).catch((caught: unknown) => caught as { pending: boolean; payment: { id: string } });
    expect(error.pending).toBe(true);
    const record = await getX402Payment(error.payment.id);
    expect(record.state).toBe('unknown');
    expect(record.authorizedAmount).toBe('100');
  });

  it('rejects a challenge above policy before signing or dispatching payment', async () => {
    await writePolicy('exact', '50');
    const expensive = challenge('exact', '51');
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify(expensive), {
        status: 402,
        headers: { 'payment-required': header(expensive) },
      })
    );
    await expect(
      executeExternalX402Request({ rawUrl: RESOURCE, nonInteractive: true, fetchImpl })
    ).rejects.toThrow('authorized by policy');
    expect(mocks.signTypedData).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('treats missing upto amount as an unknown settled amount', async () => {
    await writePolicy('upto');
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(challenge('upto')), {
          status: 402,
          headers: { 'payment-required': header(challenge('upto')) },
        })
      )
      .mockResolvedValueOnce(
        new Response('{}', {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'payment-response': header({
              success: true,
              transaction: `0x${'44'.repeat(32)}`,
              network: 'eip155:8453',
            }),
          },
        })
      );
    const error = await executeExternalX402Request({
      rawUrl: RESOURCE,
      nonInteractive: true,
      fetchImpl,
    }).catch((caught: unknown) => caught as { pending: boolean; payment: { state: string } });
    expect(error.pending).toBe(true);
    expect(error.payment.state).toBe('settled_amount_unknown');
  });
});

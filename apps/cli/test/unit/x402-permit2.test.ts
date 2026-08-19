// Verifies: ADR-0092
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readContract: vi.fn(),
  getChainId: vi.fn(),
  estimateGas: vi.fn(),
  estimateFeesPerGas: vi.fn(),
  getBalance: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  getTransactionCount: vi.fn(),
  sendTransaction: vi.fn(),
  encodeFunctionData: vi.fn(),
  signTypedData: vi.fn(),
  signTransaction: vi.fn(),
}));

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      readContract: mocks.readContract,
      getChainId: mocks.getChainId,
      estimateGas: mocks.estimateGas,
      estimateFeesPerGas: mocks.estimateFeesPerGas,
      getBalance: mocks.getBalance,
      waitForTransactionReceipt: mocks.waitForTransactionReceipt,
      getTransactionCount: mocks.getTransactionCount,
    })),
    createWalletClient: vi.fn(() => ({ sendTransaction: mocks.sendTransaction })),
    encodeFunctionData: mocks.encodeFunctionData,
  };
});

import {
  createBoundedApprovalExtension,
  ensurePermit2Approval,
} from '../../src/lib/x402-permit2.js';
import { parseX402Policy, type X402PaymentPolicy } from '../../src/lib/x402-policy.js';

const ASSET = '0x0000000000000000000000000000000000000001';
const OWNER = '0x0000000000000000000000000000000000000002';
const PAY_TO = '0x0000000000000000000000000000000000000003';
const FACILITATOR = '0x0000000000000000000000000000000000000004';

function fixture(options: {
  allowance?: bigint;
  extensions?: Record<string, unknown>;
  direct?: boolean;
  unattendedDirect?: boolean;
  gasCap?: string;
  nonInteractive?: boolean;
} = {}) {
  const payment: X402PaymentPolicy = {
    scheme: 'upto',
    network: 'eip155:8453',
    asset: ASSET,
    payTo: PAY_TO,
    maxPerPayment: '100',
    spendWindow: { seconds: 3600, max: '500' },
    permit2: {
      allowSponsoredApproval: true,
      allowDirectApproval: options.direct ?? false,
      allowUnattendedDirectApproval: options.unattendedDirect ?? false,
      maxApprovalGasWei: options.gasCap,
    },
  };
  const policy = parseX402Policy({
    version: 1,
    networks: { 'eip155:8453': { rpcUrlEnv: 'TEST_X402_RPC_URL' } },
    rules: [
      {
        id: 'test',
        origin: 'https://api.example.com',
        methods: ['GET'],
        unattended: true,
        payments: [payment],
      },
    ],
  });
  mocks.readContract.mockResolvedValue(options.allowance ?? 0n);
  return {
    policy,
    rule: policy.rules[0],
    payment: policy.rules[0].payments[0],
    requirement: {
      scheme: 'upto',
      network: 'eip155:8453' as const,
      amount: '100',
      asset: ASSET,
      payTo: PAY_TO,
      maxTimeoutSeconds: 300,
      extra: { facilitatorAddress: FACILITATOR },
    },
    paymentRequired: {
      x402Version: 2,
      resource: { url: 'https://api.example.com', description: 'test', mimeType: 'application/json' },
      accepts: [],
      extensions: options.extensions,
    },
    account: {
      address: OWNER,
      signTypedData: mocks.signTypedData,
      signTransaction: mocks.signTransaction,
    } as never,
    nonInteractive: options.nonInteractive ?? false,
    confirmDirectApproval: vi.fn().mockResolvedValue(true),
  };
}

describe('Permit2 approval policy', () => {
  const previousRpc = process.env['TEST_X402_RPC_URL'];

  beforeEach(() => {
    vi.clearAllMocks();
    process.env['TEST_X402_RPC_URL'] = 'https://rpc.example.com';
    mocks.getChainId.mockResolvedValue(8453);
    mocks.estimateGas.mockResolvedValue(50_000n);
    mocks.estimateFeesPerGas.mockResolvedValue({
      maxFeePerGas: 2n,
      maxPriorityFeePerGas: 1n,
    });
    mocks.getBalance.mockResolvedValue(1_000_000n);
    mocks.sendTransaction.mockResolvedValue(`0x${'11'.repeat(32)}`);
    mocks.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      gasUsed: 45_000n,
      effectiveGasPrice: 2n,
    });
    mocks.getTransactionCount.mockResolvedValue(7);
    mocks.encodeFunctionData.mockReturnValue('0x1234');
    mocks.signTransaction.mockResolvedValue('0xsigned');
  });

  afterEach(() => {
    if (previousRpc === undefined) delete process.env['TEST_X402_RPC_URL'];
    else process.env['TEST_X402_RPC_URL'] = previousRpc;
  });

  it('uses an existing sufficient allowance', async () => {
    const result = await ensurePermit2Approval(fixture({ allowance: 100n }));
    expect(result.mode).toBe('existing');
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it('prefers bounded EIP-2612 sponsorship', async () => {
    const result = await ensurePermit2Approval(
      fixture({ extensions: { eip2612GasSponsoring: {} } })
    );
    expect(result).toMatchObject({ mode: 'sponsored_eip2612', targetAllowance: '100' });
  });

  it('selects bounded raw-approval sponsorship when advertised', async () => {
    const result = await ensurePermit2Approval(
      fixture({ extensions: { erc20ApprovalGasSponsoring: {} }, gasCap: '1000000' })
    );
    expect(result).toMatchObject({ mode: 'sponsored_erc20', targetAllowance: '500' });
  });

  it('sends a bounded direct approval after checking gas and confirmation', async () => {
    const context = fixture({ direct: true, gasCap: '1000000' });
    const result = await ensurePermit2Approval(context);
    expect(result).toMatchObject({
      mode: 'direct',
      targetAllowance: '500',
      transaction: `0x${'11'.repeat(32)}`,
    });
    expect(context.confirmDirectApproval).toHaveBeenCalledWith(
      expect.objectContaining({ allowance: '500', estimatedGasWei: '100000' })
    );
    expect(mocks.encodeFunctionData).toHaveBeenCalledWith(
      expect.objectContaining({ args: [expect.any(String), 500n] })
    );
  });

  it('rejects direct approval above the configured gas cap', async () => {
    await expect(
      ensurePermit2Approval(fixture({ direct: true, gasCap: '99999' }))
    ).rejects.toThrow('exceeds policy cap');
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it('requires explicit unattended direct-approval permission', async () => {
    await expect(
      ensurePermit2Approval(
        fixture({ direct: true, gasCap: '1000000', nonInteractive: true })
      )
    ).rejects.toThrow('interactive confirmation');
  });

  it('fails closed when the RPC is connected to another chain', async () => {
    mocks.getChainId.mockResolvedValue(1);
    await expect(ensurePermit2Approval(fixture({ allowance: 100n }))).rejects.toThrow(
      'does not match'
    );
  });

  it('enriches sponsored approval with the bounded target, never max uint', async () => {
    const context = fixture();
    const extension = createBoundedApprovalExtension({
      account: context.account,
      policy: context.policy,
      getApprovalTarget: () => ({ amount: '500', maxGasWei: '1000000' }),
    });
    const payload = await extension.enrichPaymentPayload(
      {
        x402Version: 2,
        resource: { url: 'https://api.example.com' },
        accepted: context.requirement,
        payload: {},
      },
      {
        ...context.paymentRequired,
        extensions: { erc20ApprovalGasSponsoring: {} },
      }
    );
    expect(payload.extensions?.['erc20ApprovalGasSponsoring']).toEqual({
      info: expect.objectContaining({ amount: '500', signedTransaction: '0xsigned' }),
    });
  });
});

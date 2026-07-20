import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@privy-io/react-auth', () => ({
  getAccessToken: vi.fn().mockResolvedValue('privy-token'),
}));

import { payX402Post, type X402Deps } from './x402-client';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
vi.stubGlobal('crypto', {
  getRandomValues: (arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) arr[i] = i;
    return arr;
  },
});
vi.stubGlobal('btoa', (s: string) => Buffer.from(s, 'binary').toString('base64'));

function makeDeps(overrides: Partial<X402Deps> = {}): X402Deps {
  return {
    address: '0xRequester000000000000000000000000000000ee',
    apiUrl: 'http://api.test',
    signTypedDataAsync: vi.fn().mockResolvedValue('0xsig'),
    switchChainAsync: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const eip712Domain = {
  chainId: 84532,
  name: 'USDC',
  version: '2',
  verifyingContract: '0xUSDC0000000000000000000000000000000000ab',
};

const acceptedEip712 = {
  domain: eip712Domain,
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
};

function paymentChallenge() {
  return {
    accepts: [
      {
        amount: '1000',
        asset: 'USDC',
        network: 'base-sepolia',
        payTo: '0xPayee0000000000000000000000000000000000fe',
        scheme: 'exact',
        extra: { eip712: acceptedEip712 },
      },
    ],
  };
}

describe('payX402Post', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    localStorage.clear();
  });

  it('completes the probe → sign → retry flow on success', async () => {
    localStorage.setItem('taskmarket:legal-receipt', 'receipt-1');
    fetchMock
      .mockResolvedValueOnce({ status: 402, json: async () => paymentChallenge() })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ txHash: '0xtx', accepted: true }),
      });

    const steps: string[] = [];
    const deps = makeDeps();
    const result = await payX402Post('/api/tasks/0xabc/cancel', { taskId: '0xabc' }, deps, (s) =>
      steps.push(s)
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.txHash).toBe('0xtx');
    expect(steps).toEqual(['payment', 'signing', 'submitting']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(deps.switchChainAsync).toHaveBeenCalledWith({ chainId: 84532 });
    expect(deps.signTypedDataAsync).toHaveBeenCalledOnce();

    const retryHeaders = (fetchMock.mock.calls[1][1] as { headers: Record<string, string> })
      .headers;
    const probeHeaders = (fetchMock.mock.calls[0][1] as { headers: Record<string, string> })
      .headers;
    expect(probeHeaders['X-Taskmarket-Legal-Receipt']).toBe('receipt-1');
    expect(probeHeaders.Authorization).toBe('Bearer privy-token');
    expect(retryHeaders['X-Taskmarket-Legal-Receipt']).toBe('receipt-1');
    expect(retryHeaders.Authorization).toBe('Bearer privy-token');
    expect(retryHeaders['payment-signature']).toBeTruthy();
  });

  it('returns a rejected result when the user cancels signing', async () => {
    fetchMock.mockResolvedValueOnce({ status: 402, json: async () => paymentChallenge() });
    const deps = makeDeps({
      signTypedDataAsync: vi.fn().mockRejectedValue({ code: 4001, message: 'User rejected' }),
    });

    const result = await payX402Post('/api/tasks/0xabc/cancel', { taskId: '0xabc' }, deps);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.rejected).toBe(true);
  });

  it('surfaces a clear error when the probe does not return 402', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 500,
      text: async () => 'boom',
    });
    const deps = makeDeps();

    const result = await payX402Post('/api/tasks/0xabc/cancel', { taskId: '0xabc' }, deps);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('500');
  });

  it('surfaces a backend error from the retry call', async () => {
    fetchMock
      .mockResolvedValueOnce({ status: 402, json: async () => paymentChallenge() })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Task already cancelled' }),
      });

    const deps = makeDeps();
    const result = await payX402Post('/api/tasks/0xabc/cancel', { taskId: '0xabc' }, deps);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe('Task already cancelled');
  });
});

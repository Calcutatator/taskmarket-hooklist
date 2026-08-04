import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@privy-io/react-auth', () => ({
  getAccessToken: vi.fn().mockResolvedValue('privy-token'),
}));

import { isPendingTransactionMessage, payX402Post, type X402Deps } from './x402-client';

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

describe('in-flight relayed writes', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    localStorage.clear();
  });

  it('recognises the pending-transaction prose the backend still sends as a 500', () => {
    expect(
      isPendingTransactionMessage(
        'Server wallet transaction 0xabc (nonce 4) was broadcast but not confirmed within the request budget; it remains in flight'
      )
    ).toBe(true);
  });

  it('does not mistake an ordinary failure for an in-flight one', () => {
    expect(isPendingTransactionMessage('Task is not open')).toBe(false);
    expect(isPendingTransactionMessage('execution reverted: TaskNotOpen')).toBe(false);
  });

  // Neither success nor failure: a caller must be able to tell the two apart by a field
  // rather than by re-parsing the message themselves (ADR-0049 point 3).
  it('classifies a pending 500 as pending rather than failed', async () => {
    fetchMock
      .mockResolvedValueOnce({ status: 402, json: async () => paymentChallenge() })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({
          message:
            'Server wallet transaction 0xabc (nonce 4) was broadcast but not confirmed within the request budget; it remains in flight',
        }),
      });

    const result = await payX402Post('/api/tasks/0xabc/evaluator', {}, makeDeps());

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.pending).toBe(true);
    expect(result.ok === false && result.idempotencyKey).toBeTruthy();
  });

  it('leaves a genuine failure classified as a failure', async () => {
    fetchMock
      .mockResolvedValueOnce({ status: 402, json: async () => paymentChallenge() })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Task is not open' }),
      });

    const result = await payX402Post('/api/tasks/0xabc/evaluator', {}, makeDeps());

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.pending).toBeFalsy();
    expect(result.ok === false && result.error).toBe('Task is not open');
  });

  // Everything below is about the boundary the payment crosses: once the paid request is
  // dispatched, the money has moved and the write may be landing, so a failure that arrives
  // after that point is ambiguous rather than negative. Reporting it as a plain failure would
  // put a retry -- a second payment -- in front of the user.
  it('treats an unreadable response body after dispatch as in flight, not failed', async () => {
    fetchMock.mockResolvedValueOnce({ status: 402, json: async () => paymentChallenge() });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('Unexpected end of JSON input');
      },
    });

    const result = await payX402Post('/api/tasks/0xabc/evaluator', {}, makeDeps());

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.pending).toBe(true);
    expect(result.ok === false && result.idempotencyKey).toBeTruthy();
  });

  it('treats a connection that dies mid-submit as in flight, not failed', async () => {
    fetchMock.mockResolvedValueOnce({ status: 402, json: async () => paymentChallenge() });
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const result = await payX402Post('/api/tasks/0xabc/evaluator', {}, makeDeps(), undefined, 'k');

    expect(result.ok === false && result.pending).toBe(true);
    expect(result.ok === false && result.idempotencyKey).toBe('k');
  });

  // Nothing was sent, so telling the user to wait would be telling them to wait for a write
  // that never started.
  it('leaves a failure before dispatch as a plain failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const result = await payX402Post('/api/tasks/0xabc/evaluator', {}, makeDeps());

    expect(result.ok === false && result.pending).toBeFalsy();
    expect(result.ok === false && result.error).toBe('Failed to fetch');
  });

  // A declined signature is pre-dispatch by construction: no payment, no request.
  it('keeps a wallet cancellation a rejection rather than an in-flight write', async () => {
    fetchMock.mockResolvedValueOnce({ status: 402, json: async () => paymentChallenge() });
    const deps = makeDeps({
      signTypedDataAsync: vi.fn().mockRejectedValue({ code: 4001, message: 'User rejected' }),
    });

    const result = await payX402Post('/api/tasks/0xabc/evaluator', {}, deps);

    expect(result.ok === false && result.rejected).toBe(true);
    expect(result.ok === false && result.pending).toBeFalsy();
  });

  it('sends the caller-supplied idempotency key on the paid submit', async () => {
    fetchMock
      .mockResolvedValueOnce({ status: 402, json: async () => paymentChallenge() })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ txHash: '0xtx' }) });

    const result = await payX402Post(
      '/api/tasks/0xabc/evaluator',
      {},
      makeDeps(),
      undefined,
      'caller-key'
    );

    const headers = (fetchMock.mock.calls[1][1] as { headers: Record<string, string> }).headers;
    expect(headers['X-Taskmarket-Idempotency-Key']).toBe('caller-key');
    expect(result.ok && result.idempotencyKey).toBe('caller-key');
  });
});

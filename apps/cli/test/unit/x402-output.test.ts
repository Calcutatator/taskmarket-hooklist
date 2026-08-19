// Verifies: ADR-0092
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderFailure } from '../../src/lib/output.js';
import { ExternalX402Error } from '../../src/lib/x402-errors.js';
import type { X402PaymentRecord } from '../../src/lib/x402-journal.js';

describe('external x402 failure output', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('renders pending and the exact journal record on an ambiguous paid failure', () => {
    const payment: X402PaymentRecord = {
      id: 'payment-id',
      state: 'unknown',
      createdAt: '2026-08-19T00:00:00.000Z',
      updatedAt: '2026-08-19T00:00:01.000Z',
      ruleId: 'rule',
      origin: 'https://api.example.com',
      pathname: '/paid',
      requestHash: 'hash',
      method: 'GET',
      payer: '0x0000000000000000000000000000000000000001',
      scheme: 'upto',
      network: 'eip155:8453',
      asset: '0x0000000000000000000000000000000000000002',
      payTo: '0x0000000000000000000000000000000000000003',
      authorizedAmount: '100',
    };
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    renderFailure(
      new ExternalX402Error('External x402 outcome is unknown; do not retry', {
        payment,
        pending: true,
        status: 502,
      })
    );
    expect(JSON.parse(write.mock.calls[0][0] as string)).toEqual({
      ok: false,
      error: 'External x402 outcome is unknown; do not retry',
      status: 502,
      pending: true,
      payment,
    });
    expect(process.exitCode).toBe(1);
  });
});

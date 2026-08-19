// Verifies: ADR-0092
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getX402Payment,
  listX402Payments,
  reserveX402Payment,
  resolveX402PaymentManually,
  transitionX402Payment,
} from '../../src/lib/x402-journal.js';
import type { X402PolicyAuthorization } from '../../src/lib/x402-policy.js';

const ASSET = '0x0000000000000000000000000000000000000001';
const PAY_TO = '0x0000000000000000000000000000000000000002';
const PAYER = '0x0000000000000000000000000000000000000003';

function authorization(amount: string, windowMaximum = '100'): X402PolicyAuthorization {
  return {
    rule: {
      id: 'test-rule',
      enabled: true,
      priority: 0,
      origin: 'https://api.example.com',
      pathPrefix: '/',
      methods: ['GET'],
      unattended: true,
      allowPrivateNetwork: false,
      maxAuthorizationSeconds: 300,
      payments: [
        {
          scheme: 'upto',
          network: 'eip155:8453',
          asset: ASSET,
          payTo: PAY_TO,
          maxPerPayment: amount,
          spendWindow: { seconds: 3600, max: windowMaximum },
        },
      ],
    },
    payment: {
      scheme: 'upto',
      network: 'eip155:8453',
      asset: ASSET,
      payTo: PAY_TO,
      maxPerPayment: amount,
      spendWindow: { seconds: 3600, max: windowMaximum },
    },
    requirement: {
      scheme: 'upto',
      network: 'eip155:8453',
      amount,
      asset: ASSET,
      payTo: PAY_TO,
      maxTimeoutSeconds: 300,
    },
    windowStartedAt: new Date(Date.now() - 3_600_000).toISOString(),
  };
}

describe('x402 payment journal', () => {
  let temporaryDirectory: string;
  let journalPath: string;

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'x402-journal-test-'));
    journalPath = path.join(temporaryDirectory, 'payments.jsonl');
  });

  afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  function reserve(amount: string, maximum = '100') {
    return reserveX402Payment(
      {
        authorization: authorization(amount, maximum),
        url: new URL('https://api.example.com/generate?secret=hidden'),
        method: 'GET',
        requestHash: `hash-${amount}-${Math.random()}`,
        payer: PAYER,
      },
      journalPath
    );
  }

  async function dispatch(id: string) {
    await transitionX402Payment(id, { state: 'ready' }, journalPath);
    await transitionX402Payment(id, { state: 'dispatched' }, journalPath);
  }

  it('writes owner-only append-only records without query strings', async () => {
    const record = await reserve('40');
    expect(record.pathname).toBe('/generate');
    expect(record.origin).toBe('https://api.example.com');
    expect((await fs.stat(journalPath)).mode & 0o777).toBe(0o600);
    expect(await getX402Payment(record.id, journalPath)).toEqual(record);
    expect(await fs.readFile(journalPath, 'utf8')).not.toContain('secret=hidden');
  });

  it('atomically refuses concurrent reservations above the window', async () => {
    const results = await Promise.allSettled([reserve('60'), reserve('60')]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('rejects a journal accessible by group or others', async () => {
    await reserve('40');
    await fs.chmod(journalPath, 0o644);
    await expect(listX402Payments({}, journalPath)).rejects.toThrow('only by its owner');
  });

  it('counts unknown payments at their authorized maximum', async () => {
    const first = await reserve('60');
    await dispatch(first.id);
    await transitionX402Payment(first.id, { state: 'unknown' }, journalPath);
    await expect(reserve('50')).rejects.toThrow('spending window exceeded');
  });

  it('keeps unresolved payments counted after the rolling window elapses', async () => {
    const oldAuthorization = authorization('60');
    oldAuthorization.windowStartedAt = new Date(Date.now() - 1_000).toISOString();
    const first = await reserveX402Payment(
      {
        authorization: oldAuthorization,
        url: new URL('https://api.example.com/generate'),
        method: 'GET',
        requestHash: 'old-unknown',
        payer: PAYER,
        now: new Date(Date.now() - 10_000),
      },
      journalPath
    );
    await dispatch(first.id);
    await transitionX402Payment(first.id, { state: 'unknown' }, journalPath);
    await expect(reserve('50')).rejects.toThrow('spending window exceeded');
  });

  it('releases the unused portion of an upto settlement', async () => {
    const first = await reserve('80');
    await dispatch(first.id);
    await transitionX402Payment(
      first.id,
      { state: 'settled', settledAmount: '20' },
      journalPath
    );
    await expect(reserve('80')).resolves.toBeDefined();
  });

  it('releases a failed-before-dispatch reservation', async () => {
    const first = await reserve('100');
    await transitionX402Payment(first.id, { state: 'failed_before_dispatch' }, journalPath);
    await expect(reserve('100')).resolves.toBeDefined();
  });

  it('refuses a settlement amount above the authorization', async () => {
    const record = await reserve('40');
    await dispatch(record.id);
    await expect(
      transitionX402Payment(
        record.id,
        { state: 'settled', settledAmount: '41' },
        journalPath
      )
    ).rejects.toThrow('exceeds authorized');
  });

  it('refuses terminal-state rewrites', async () => {
    const record = await reserve('40');
    await dispatch(record.id);
    await transitionX402Payment(
      record.id,
      { state: 'settled', settledAmount: '40' },
      journalPath
    );
    await expect(
      transitionX402Payment(record.id, { state: 'unknown' }, journalPath)
    ).rejects.toThrow("cannot transition from 'settled'");
  });

  it('keeps an audit event for manual resolution', async () => {
    const record = await reserve('40');
    await dispatch(record.id);
    await transitionX402Payment(record.id, { state: 'unknown' }, journalPath);
    const resolved = await resolveX402PaymentManually(
      { id: record.id, settledAmount: '12', note: 'verified on explorer' },
      journalPath
    );
    expect(resolved.state).toBe('manually_resolved');
    expect(resolved.settledAmount).toBe('12');
    expect((await fs.readFile(journalPath, 'utf8')).trim().split('\n')).toHaveLength(5);
  });

  it('refuses manual resolution of a payment that is already settled', async () => {
    const record = await reserve('40');
    await dispatch(record.id);
    await transitionX402Payment(
      record.id,
      { state: 'settled', settledAmount: '40' },
      journalPath
    );
    await expect(
      resolveX402PaymentManually(
        { id: record.id, settledAmount: '0', note: 'invalid rewrite' },
        journalPath
      )
    ).rejects.toThrow('cannot be resolved manually');
  });

  it('filters and orders latest records', async () => {
    const first = await reserve('10');
    await dispatch(first.id);
    await transitionX402Payment(first.id, { state: 'settled', settledAmount: '5' }, journalPath);
    await reserve('10');
    const settled = await listX402Payments({ state: 'settled' }, journalPath);
    expect(settled).toHaveLength(1);
    expect(settled[0].id).toBe(first.id);
  });

  it('fails closed on a corrupt journal line', async () => {
    await fs.writeFile(journalPath, '{not-json}\n', { mode: 0o600 });
    await expect(listX402Payments({}, journalPath)).rejects.toThrow('Corrupt');
  });
});

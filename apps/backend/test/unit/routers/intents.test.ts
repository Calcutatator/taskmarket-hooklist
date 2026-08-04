// Verifies: ADR-0049, ADR-0052
import { afterAll, describe, expect, it, vi } from 'vitest';
import { stubServerEnvironment } from '../../helpers/server-environment';
import { createMockCtx, makeChain } from '../helpers';

const restoreServerEnvironment = stubServerEnvironment();

const { intentsRouter } = await import('../../../src/routers/intents.router');

afterAll(restoreServerEnvironment);

const PAYER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const KEY = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const PAYMENT = `0x${'99'.repeat(32)}`;

function intentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'intent-1',
    idempotencyKey: KEY,
    lastError: null,
    operation: 'tasks.create',
    payer: PAYER,
    paymentTxHash: null,
    status: 'broadcast',
    txHash: `0x${'ab'.repeat(32)}`,
    ...overrides,
  };
}

/** Routes each SELECT to the table it names, so the intent and refund reads stay distinct. */
function ctxFor(intent: Record<string, unknown> | null, refund?: Record<string, unknown>) {
  const ctx = createMockCtx(undefined, { address: PAYER });
  ctx.db.select = vi.fn((columns?: unknown) => {
    const isRefundRead = columns !== undefined;
    return makeChain(isRefundRead ? (refund ? [refund] : []) : intent ? [intent] : []);
  });
  return ctx;
}

describe('intents.get', () => {
  it('reports status, hash and operation for the payer’s own intent', async () => {
    const ctx = ctxFor(intentRow());

    const result = await intentsRouter.createCaller(ctx as never).get({ intentId: 'intent-1' });

    expect(result).toMatchObject({ operation: 'tasks.create', status: 'broadcast' });
    // In flight is its own answer, not a 500 whose prose has to be parsed (ADR-0049 point 3).
    expect(result.terminalReason).toBeNull();
  });

  it('answers by idempotency key, for a caller who never received the intent id', async () => {
    const ctx = ctxFor(intentRow());

    const result = await intentsRouter.createCaller(ctx as never).get({ idempotencyKey: KEY });

    expect(result.intentId).toBe('intent-1');
  });

  it('gives a non-payer exactly what it gives someone asking about nothing', async () => {
    const ctx = ctxFor(intentRow({ payer: OTHER }));
    const missing = ctxFor(null);

    const asStranger = intentsRouter
      .createCaller(ctx as never)
      .get({ intentId: 'intent-1' })
      .catch((error: Error) => error.message);
    const asNobody = intentsRouter
      .createCaller(missing as never)
      .get({ intentId: 'nope' })
      .catch((error: Error) => error.message);

    // Payment facts are not public reads, and the two answers must be indistinguishable or
    // this becomes an oracle for which intent ids exist.
    expect(await asStranger).toBe(await asNobody);
  });

  it('reports the refund state for an intent whose payment was written off', async () => {
    const ctx = ctxFor(
      intentRow({ lastError: 'reverted', paymentTxHash: PAYMENT, status: 'failed' }),
      { refundStatus: 'refunded', refundTxHash: `0x${'cd'.repeat(32)}` }
    );

    const result = await intentsRouter.createCaller(ctx as never).get({ intentId: 'intent-1' });

    // The gap ADR-0048 left open: before this, a refunded payer found out by watching their
    // own wallet or by inferring it from a task that never appeared.
    expect(result.refund).toEqual({ status: 'refunded', txHash: `0x${'cd'.repeat(32)}` });
    expect(result.terminalReason).toBe('reverted');
  });

  it('requires exactly one of intentId and idempotencyKey', async () => {
    const ctx = ctxFor(intentRow());
    const caller = intentsRouter.createCaller(ctx as never);

    await expect(caller.get({})).rejects.toThrow();
    await expect(caller.get({ idempotencyKey: KEY, intentId: 'intent-1' })).rejects.toThrow();
  });
});

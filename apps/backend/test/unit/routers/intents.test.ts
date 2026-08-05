// Verifies: ADR-0049, ADR-0052
// Verifies: ADR-0055
// Verifies: ADR-0059
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

/**
 * Routes each SELECT to the table it names, so the intent, task and refund reads stay
 * distinct. Only the intent read is untyped; the other two are told apart by the columns
 * they ask for.
 */
function ctxFor(
  intent: Record<string, unknown> | null,
  refund?: Record<string, unknown>,
  task?: Record<string, unknown>,
  callerAddress: string = PAYER
) {
  // Lowercased the way `resolveCaller` lowercases a verified address, so a test cannot pass by
  // comparing two strings the real context would never have produced.
  const ctx = createMockCtx(undefined, { address: callerAddress.toLowerCase() });
  ctx.db.select = vi.fn((columns?: Record<string, unknown>) => {
    if (columns === undefined) return makeChain(intent ? [intent] : []);
    if ('refundStatus' in columns) return makeChain(refund ? [refund] : []);
    return makeChain(task ? [task] : []);
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

  /**
   * Verifies: ADR-0059
   *
   * One rule, not two. The same comparison that answers a paid intent answers a free one, so
   * these cases are here to pin that the free path is not a second branch with its own
   * behaviour -- it is the same branch, reached with no payment on the row.
   */
  describe('a free write, with no payment facts on the row at all', () => {
    const freeIntent = (overrides: Record<string, unknown> = {}) =>
      intentRow({ operation: 'evaluations.finalizeVerdict', paymentTxHash: null, ...overrides });

    it('is readable by the address recorded as having initiated it', async () => {
      const ctx = ctxFor(freeIntent());

      const result = await intentsRouter.createCaller(ctx as never).get({ intentId: 'intent-1' });

      // Without this the caller ADR-0058 hands an intent id to, and tells to poll rather than
      // resubmit, is told their own write does not exist.
      expect(result).toMatchObject({ operation: 'evaluations.finalizeVerdict', refund: null });
    });

    it('gives a non-initiator exactly what it gives someone asking about nothing', async () => {
      const ctx = ctxFor(freeIntent({ payer: OTHER }));
      const missing = ctxFor(null);

      const asStranger = intentsRouter
        .createCaller(ctx as never)
        .get({ intentId: 'intent-1' })
        .catch((error: Error) => error.message);
      const asNobody = intentsRouter
        .createCaller(missing as never)
        .get({ intentId: 'nope' })
        .catch((error: Error) => error.message);

      // "Not yours" stays indistinguishable from "does not exist" whether or not money is
      // involved: the surface must not become an oracle for which intent ids exist.
      expect(await asStranger).toBe(await asNobody);
    });

    it('is readable by no address when no initiator was recorded', async () => {
      const ctx = ctxFor(freeIntent({ payer: null }));
      const missing = ctxFor(null);

      const asAnyone = intentsRouter
        .createCaller(ctx as never)
        .get({ intentId: 'intent-1' })
        .catch((error: Error) => error.message);
      const asNobody = intentsRouter
        .createCaller(missing as never)
        .get({ intentId: 'nope' })
        .catch((error: Error) => error.message);

      // A permissionless caller who never said who they were left nothing to compare an
      // address against. An id names an intent without proving anything about who is asking,
      // so an id lookup gets the same answer as an id that does not exist. The key is the
      // other handle and it is evidence; see the reservation cases below.
      expect(await asAnyone).toBe(await asNobody);
    });
  });

  /**
   * Verifies: ADR-0059, ADR-0067
   *
   * A reservation is an intent that exists before its payer does. ADR-0059 scopes an intent to
   * "the address recorded as having initiated it", and on a reservation nothing is recorded
   * yet -- so the address rule has no address to compare and answers nobody, while the 409 that
   * created the row tells the caller to poll this very surface. The other handle ADR-0052 gave
   * them is the idempotency key they minted before sending, and possession of it is what the
   * row can actually be matched against.
   */
  describe('a reservation, whose payer is not known yet', () => {
    const reservation = (overrides: Record<string, unknown> = {}) =>
      intentRow({
        operation: 'x402.reservation',
        payer: null,
        paymentTxHash: null,
        status: 'reserved',
        txHash: null,
        ...overrides,
      });

    it('is readable by the holder of the idempotency key that claimed it', async () => {
      const ctx = ctxFor(reservation());

      const result = await intentsRouter.createCaller(ctx as never).get({ idempotencyKey: KEY });

      expect(result).toMatchObject({ intentId: 'intent-1', status: 'reserved' });
    });

    it('is readable by the payer of the authorization it recorded before settling', async () => {
      // Once the middleware has written the authorization down (ADR-0067) an address *is*
      // recorded, so the address rule has something to compare again -- without the key.
      const ctx = ctxFor(reservation({ paymentAuthPayer: PAYER }));

      const result = await intentsRouter.createCaller(ctx as never).get({ intentId: 'intent-1' });

      expect(result.status).toBe('reserved');
    });

    it('gives a caller presenting nothing but an id what it gives someone asking about nothing', async () => {
      const ctx = ctxFor(reservation());
      const missing = ctxFor(null);

      const byId = intentsRouter
        .createCaller(ctx as never)
        .get({ intentId: 'intent-1' })
        .catch((error: Error) => error.message);
      const asNobody = intentsRouter
        .createCaller(missing as never)
        .get({ intentId: 'nope' })
        .catch((error: Error) => error.message);

      expect(await byId).toBe(await asNobody);
    });

    it('does not let a key unlock an intent that has a payer', async () => {
      // The key is the credential only where no initiator was recorded. Once one is, the
      // address rule is the rule, and a leaked key buys nothing that was not already leaked.
      const ctx = ctxFor(intentRow({ payer: OTHER }));
      const missing = ctxFor(null);

      const withKey = intentsRouter
        .createCaller(ctx as never)
        .get({ idempotencyKey: KEY })
        .catch((error: Error) => error.message);
      const asNobody = intentsRouter
        .createCaller(missing as never)
        .get({ idempotencyKey: 'ffffffff-ffff-4fff-8fff-ffffffffffff' })
        .catch((error: Error) => error.message);

      expect(await withKey).toBe(await asNobody);
    });
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

  /**
   * Verifies: ADR-0045, ADR-0049
   *
   * A creation that goes in flight cannot be told its task id -- the contract has not derived
   * one yet, and predicting it is exactly what let two concurrent creates by one requester
   * name the same task. So the id has to be learnable afterwards, and the idempotency key the
   * caller generated themselves is the handle they still hold when the response never
   * arrived (ADR-0052).
   */
  describe('the task id a creation eventually got', () => {
    const TASK_ID = `0x${'ab'.repeat(32)}`;

    it('reports it once the creation has completed', async () => {
      const ctx = ctxFor(intentRow({ status: 'completed' }), undefined, { id: TASK_ID });

      const result = await intentsRouter.createCaller(ctx as never).get({ idempotencyKey: KEY });

      expect(result.taskId).toBe(TASK_ID);
    });

    it('reports nothing while the creation is still in flight', async () => {
      // The chain-event indexer may already have inserted a row for this transaction. Reading
      // it back here would tell a caller their creation is done while its completion -- the
      // description, the reward, the allowed viewers -- has not run.
      const ctx = ctxFor(intentRow({ status: 'broadcast' }), undefined, { id: TASK_ID });

      const result = await intentsRouter.createCaller(ctx as never).get({ intentId: 'intent-1' });

      expect(result.taskId).toBeNull();
    });

    it('reports nothing for an operation that creates no task', async () => {
      const ctx = ctxFor(
        intentRow({ operation: 'submissions.submit', status: 'completed' }),
        undefined,
        { id: TASK_ID }
      );

      const result = await intentsRouter.createCaller(ctx as never).get({ intentId: 'intent-1' });

      expect(result.taskId).toBeNull();
    });
  });

  it('requires exactly one of intentId and idempotencyKey', async () => {
    const ctx = ctxFor(intentRow());
    const caller = intentsRouter.createCaller(ctx as never);

    await expect(caller.get({})).rejects.toThrow();
    await expect(caller.get({ idempotencyKey: KEY, intentId: 'intent-1' })).rejects.toThrow();
  });
});

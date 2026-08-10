import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import { makeChain } from '../helpers';

vi.mock('../../../src/services/contract', () => ({
  contractRefundOrphanedPayment: vi.fn(),
}));

import {
  recordAndRefundOrphanedPayment,
  refundDidNotComplete,
  settlePendingOrphanedRefunds,
  retryFailedOrphanedRefunds,
  handlePostPaymentFailure,
  handleStandardFeePostPaymentFailure,
} from '../../../src/services/orphaned-payments';
import { contractRefundOrphanedPayment } from '../../../src/services/contract';
import { ServerTransactionPendingError } from '../../../src/lib/server-transaction-dispatcher';

const PAYER = '0x1111111111111111111111111111111111111111';
const PAYMENT_TX_HASH = '0xaaaa000000000000000000000000000000000000000000000000000000000000';
const REFUND_TX_HASH = '0xbbbb000000000000000000000000000000000000000000000000000000000000';

// A chainable update() mock: `.set().where()` awaits to `resolveValue`, and
// `.returning()` resolves to `returningValue` -- attemptRefund's claim step calls
// `.returning()`, its final status-set call does not.
function updateChain(returningValue: unknown[] = []) {
  const chain: any = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(returningValue),
    then: (onfulfilled: any, onrejected?: any) =>
      Promise.resolve(undefined).then(onfulfilled, onrejected),
  };
  return chain;
}

function makeFakeDb() {
  return {
    insert: vi.fn(),
    update: vi.fn(),
    select: vi.fn(),
  };
}

describe('services/orphaned-payments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recordAndRefundOrphanedPayment', () => {
    it('records the orphan, claims it, and refunds on success', async () => {
      const db = makeFakeDb();
      db.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
      // First update() call is the claim (pending/failed -> refunding); it must
      // return a non-empty row array to signal the claim succeeded. Second is the
      // final status-set to 'refunded'.
      db.update
        .mockReturnValueOnce(updateChain([{ id: 'ignored' }]))
        .mockReturnValueOnce(updateChain());
      vi.mocked(contractRefundOrphanedPayment).mockResolvedValue(REFUND_TX_HASH as `0x${string}`);

      const result = await recordAndRefundOrphanedPayment({
        db: db as any,
        payer: PAYER as `0x${string}`,
        amount: 1000n,
        paymentTxHash: PAYMENT_TX_HASH as `0x${string}`,
        context: 'task_create',
        failureReason: 'Contract call rejected: EnforcedPause',
      });

      expect(result).toEqual({ pending: false, refunded: true, refundTxHash: REFUND_TX_HASH });
      expect(contractRefundOrphanedPayment).toHaveBeenCalledWith(PAYER, 1000n);
      expect(db.insert).toHaveBeenCalledOnce();
    });

    it('does not attempt a refund when the insert fails (e.g. duplicate paymentTxHash)', async () => {
      const db = makeFakeDb();
      db.insert.mockReturnValue({
        values: vi
          .fn()
          .mockRejectedValue(new Error('duplicate key value violates unique constraint')),
      });

      const result = await recordAndRefundOrphanedPayment({
        db: db as any,
        payer: PAYER as `0x${string}`,
        amount: 1000n,
        paymentTxHash: PAYMENT_TX_HASH as `0x${string}`,
        context: 'task_create',
        failureReason: 'boom',
      });

      expect(result).toEqual({ pending: false, refunded: false, refundTxHash: null });
      expect(contractRefundOrphanedPayment).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
    });

    it('marks the row failed (not refunded) when the on-chain transfer itself reverts', async () => {
      const db = makeFakeDb();
      db.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
      db.update
        .mockReturnValueOnce(updateChain([{ id: 'ignored' }])) // claim succeeds
        .mockReturnValueOnce(updateChain()); // final status -> 'failed'
      vi.mocked(contractRefundOrphanedPayment).mockRejectedValue(
        new Error('insufficient funds for gas')
      );

      const result = await recordAndRefundOrphanedPayment({
        db: db as any,
        payer: PAYER as `0x${string}`,
        amount: 1000n,
        paymentTxHash: PAYMENT_TX_HASH as `0x${string}`,
        context: 'task_create',
        failureReason: 'boom',
      });

      expect(result).toEqual({ pending: false, refunded: false, refundTxHash: null });
    });

    /**
     * The same rule `handlePostPaymentFailure` states at its own guard, one level down: a
     * pending transaction is not a failed one. `contractRefundOrphanedPayment` raises
     * `ServerTransactionPendingError` when the refund transfer was broadcast but its receipt
     * did not arrive in the request budget -- the transfer is live. Writing 'failed' there
     * puts the row straight back in `retryFailedOrphanedRefunds`'s claimable set, and the
     * retry sends a second plain ERC-20 transfer for the same payment. There is no on-chain
     * idempotency behind it, so that is two refunds for one payment.
     */
    it('does not mark a row failed when the refund transfer is still in flight', async () => {
      const db = makeFakeDb();
      db.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
      const claim = updateChain([{ id: 'ignored' }]);
      const settle = updateChain();
      db.update.mockReturnValueOnce(claim).mockReturnValueOnce(settle);
      vi.mocked(contractRefundOrphanedPayment).mockRejectedValue(
        new ServerTransactionPendingError(REFUND_TX_HASH as `0x${string}`, 11)
      );

      const result = await recordAndRefundOrphanedPayment({
        db: db as any,
        payer: PAYER as `0x${string}`,
        amount: 1000n,
        paymentTxHash: PAYMENT_TX_HASH as `0x${string}`,
        context: 'task_create',
        failureReason: 'boom',
      });

      // The live hash is reported and recorded, and the row is not claimable again.
      expect(result).toEqual({
        pending: true,
        refunded: false,
        refundTxHash: REFUND_TX_HASH,
      });

      const written = settle.set.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
      expect(written?.refundStatus).not.toBe('failed');
      expect(written?.refundTxHash).toBe(REFUND_TX_HASH);
    });

    it('leaves an in-flight refund in a state retryFailedOrphanedRefunds cannot re-claim', async () => {
      const db = makeFakeDb();
      db.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
      const claim = updateChain([{ id: 'ignored' }]);
      const settle = updateChain();
      db.update.mockReturnValueOnce(claim).mockReturnValueOnce(settle);
      vi.mocked(contractRefundOrphanedPayment).mockRejectedValue(
        new ServerTransactionPendingError(REFUND_TX_HASH as `0x${string}`, 11)
      );

      await recordAndRefundOrphanedPayment({
        db: db as any,
        payer: PAYER as `0x${string}`,
        amount: 1000n,
        paymentTxHash: PAYMENT_TX_HASH as `0x${string}`,
        context: 'task_create',
        failureReason: 'boom',
      });

      // `retryFailedOrphanedRefunds` selects on 'failed' and `attemptRefund` claims
      // 'pending'/'failed'. Any status outside that set is safe; 'refunding' is the one the
      // row is already holding and the one the schema's check constraint permits.
      // The settle update must have happened at all -- an absent `set` payload would make the
      // status check below pass on `undefined` rather than on a status.
      const written = settle.set.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
      expect(written).toBeDefined();
      expect(['pending', 'failed']).not.toContain(written?.refundStatus);
    });
  });

  describe('retryFailedOrphanedRefunds (the race-condition guard)', () => {
    it('retries every failed row and reports success', async () => {
      const db = makeFakeDb();
      db.select.mockReturnValue(
        makeChain([
          { id: 'orphan_1', payer: PAYER, amount: '1000', paymentTxHash: PAYMENT_TX_HASH },
        ])
      );
      db.update
        .mockReturnValueOnce(updateChain([{ id: 'orphan_1' }])) // claim succeeds
        .mockReturnValueOnce(updateChain()); // final status -> 'refunded'
      vi.mocked(contractRefundOrphanedPayment).mockResolvedValue(REFUND_TX_HASH as `0x${string}`);

      const results = await retryFailedOrphanedRefunds(db as any);

      expect(results).toEqual([
        { id: 'orphan_1', payer: PAYER, refunded: true, refundTxHash: REFUND_TX_HASH },
      ]);
      expect(contractRefundOrphanedPayment).toHaveBeenCalledTimes(1);
    });

    it('never sends a second on-chain transfer for a row a concurrent retry already claimed', async () => {
      // Simulates two overlapping invocations of the retry sweep (e.g. a cron
      // overlapping a manual `make db retry-orphaned-refunds` run) racing on the
      // same 'failed' row: this call's claim UPDATE affects zero rows because the
      // other invocation already flipped refund_status to 'refunding' first.
      const db = makeFakeDb();
      db.select.mockReturnValue(
        makeChain([
          { id: 'orphan_1', payer: PAYER, amount: '1000', paymentTxHash: PAYMENT_TX_HASH },
        ])
      );
      db.update.mockReturnValueOnce(updateChain([])); // claim affects 0 rows -- already claimed

      const results = await retryFailedOrphanedRefunds(db as any);

      expect(results).toEqual([
        { id: 'orphan_1', payer: PAYER, refunded: false, refundTxHash: null },
      ]);
      // The whole point of the guard: never call the chain for a row that wasn't claimed.
      expect(contractRefundOrphanedPayment).not.toHaveBeenCalled();
      // Only the claim UPDATE ran -- no second update() call to set a final status,
      // since attemptRefund returns immediately after a failed claim.
      expect(db.update).toHaveBeenCalledTimes(1);
    });

    it('processes multiple failed rows sequentially, not concurrently', async () => {
      const db = makeFakeDb();
      db.select.mockReturnValue(
        makeChain([
          { id: 'orphan_1', payer: PAYER, amount: '1000', paymentTxHash: '0x01' },
          { id: 'orphan_2', payer: PAYER, amount: '2000', paymentTxHash: '0x02' },
        ])
      );
      db.update
        .mockReturnValueOnce(updateChain([{ id: 'orphan_1' }]))
        .mockReturnValueOnce(updateChain())
        .mockReturnValueOnce(updateChain([{ id: 'orphan_2' }]))
        .mockReturnValueOnce(updateChain());
      vi.mocked(contractRefundOrphanedPayment).mockResolvedValue(REFUND_TX_HASH as `0x${string}`);

      const results = await retryFailedOrphanedRefunds(db as any);

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.refunded)).toBe(true);
      expect(contractRefundOrphanedPayment).toHaveBeenNthCalledWith(1, PAYER, 1000n);
      expect(contractRefundOrphanedPayment).toHaveBeenNthCalledWith(2, PAYER, 2000n);
    });
  });

  // Verifies: ADR-0069
  describe('settlePendingOrphanedRefunds (the exit from `refunding`)', () => {
    function dbWithJoinRows(rows: unknown[]) {
      const db = makeFakeDb() as any;
      db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(rows),
          }),
        }),
      });
      db.update.mockReturnValue(updateChain());
      return db;
    }

    it('marks a pending refund refunded once its own transfer confirms', async () => {
      const db = dbWithJoinRows([
        {
          id: 'orphan_1',
          outboxStatus: 'confirmed',
          outboxTxHash: REFUND_TX_HASH,
          refundTxHash: REFUND_TX_HASH,
        },
      ]);

      await expect(settlePendingOrphanedRefunds(db as any)).resolves.toEqual([
        { id: 'orphan_1', refundStatus: 'refunded' },
      ]);
      expect(db.update).toHaveBeenCalledTimes(1);
    });

    it('does not claim success for a refund transfer that was superseded', async () => {
      // The outbox row confirmed, but on the replacement's hash: the payer's money never left
      // the server wallet, so this must land where the retry sweep will send it again.
      const db = dbWithJoinRows([
        {
          id: 'orphan_1',
          outboxStatus: 'confirmed',
          outboxTxHash: '0xcccc000000000000000000000000000000000000000000000000000000000000',
          refundTxHash: REFUND_TX_HASH,
        },
      ]);

      await expect(settlePendingOrphanedRefunds(db as any)).resolves.toEqual([
        { id: 'orphan_1', refundStatus: 'failed' },
      ]);
    });

    it('leaves a transfer that is still in flight exactly where it is', async () => {
      const db = dbWithJoinRows([
        {
          id: 'orphan_1',
          outboxStatus: 'broadcast',
          outboxTxHash: REFUND_TX_HASH,
          refundTxHash: REFUND_TX_HASH,
        },
      ]);

      await expect(settlePendingOrphanedRefunds(db as any)).resolves.toEqual([]);
      expect(db.update).not.toHaveBeenCalled();
    });

    it('hands a reverted transfer back to the retry sweep', async () => {
      const db = dbWithJoinRows([
        {
          id: 'orphan_1',
          outboxStatus: 'failed',
          outboxTxHash: REFUND_TX_HASH,
          refundTxHash: REFUND_TX_HASH,
        },
      ]);

      await expect(settlePendingOrphanedRefunds(db as any)).resolves.toEqual([
        { id: 'orphan_1', refundStatus: 'failed' },
      ]);
    });
  });

  describe('handlePostPaymentFailure', () => {
    // Verifies: ADR-0045
    it('never refunds a transaction that is still in flight', async () => {
      const db = makeFakeDb();
      const pending = new ServerTransactionPendingError(
        `0x${'cd'.repeat(32)}` as `0x${string}`,
        42
      );

      await expect(
        handlePostPaymentFailure({
          db: db as any,
          payer: PAYER,
          amount: 1_000_000n,
          paymentTxHash: PAYMENT_TX_HASH,
          context: 'createTask',
          error: pending,
        })
      ).rejects.toBe(pending);

      // The whole point: a broadcast transaction may still be mined by the reconciler, so
      // no orphan row is recorded and no refund transfer is sent. Refunding here would pay
      // the requester back for a task that then lands on chain anyway.
      expect(db.insert).not.toHaveBeenCalled();
      expect(contractRefundOrphanedPayment).not.toHaveBeenCalled();
    });

    it('rethrows the original error unchanged when no payment ever settled', async () => {
      const db = makeFakeDb();
      const originalError = new TRPCError({ code: 'BAD_REQUEST', message: 'unknown revert' });

      await expect(
        handlePostPaymentFailure({
          db: db as any,
          payer: PAYER as `0x${string}`,
          amount: 1000n,
          paymentTxHash: undefined,
          context: 'task_create',
          error: originalError,
        })
      ).rejects.toBe(originalError);

      expect(db.insert).not.toHaveBeenCalled();
      expect(contractRefundOrphanedPayment).not.toHaveBeenCalled();
    });

    it('throws an augmented error noting the refund when one settled and refunded successfully', async () => {
      const db = makeFakeDb();
      db.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
      db.update.mockReturnValueOnce(updateChain([{ id: 'x' }])).mockReturnValueOnce(updateChain());
      vi.mocked(contractRefundOrphanedPayment).mockResolvedValue(REFUND_TX_HASH as `0x${string}`);
      const originalError = new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Contract call rejected: EnforcedPause',
      });

      await expect(
        handlePostPaymentFailure({
          db: db as any,
          payer: PAYER as `0x${string}`,
          amount: 1000n,
          paymentTxHash: PAYMENT_TX_HASH as `0x${string}`,
          context: 'task_create',
          error: originalError,
        })
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: expect.stringContaining('automatically refunded'),
      });
    });

    it('flags for manual review when the refund itself could not be completed', async () => {
      const db = makeFakeDb();
      db.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
      db.update.mockReturnValueOnce(updateChain([{ id: 'x' }])).mockReturnValueOnce(updateChain());
      vi.mocked(contractRefundOrphanedPayment).mockRejectedValue(
        new Error('insufficient funds for gas')
      );
      const originalError = new Error('plain, non-TRPCError failure');

      await expect(
        handlePostPaymentFailure({
          db: db as any,
          payer: PAYER as `0x${string}`,
          amount: 1000n,
          paymentTxHash: PAYMENT_TX_HASH as `0x${string}`,
          context: 'task_create',
          error: originalError,
        })
      ).rejects.toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
        message: expect.stringContaining('flagged for manual review'),
      });
    });
  });

  // Verifies: ADR-0069
  describe('refundDidNotComplete (structured, not string-matched)', () => {
    async function failureFrom(refundResult: 'ok' | 'pending' | 'failed', message: string) {
      const db = makeFakeDb();
      db.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
      db.update
        .mockReturnValueOnce(updateChain([{ id: 'ignored' }]))
        .mockReturnValueOnce(updateChain());
      if (refundResult === 'ok') {
        vi.mocked(contractRefundOrphanedPayment).mockResolvedValue(REFUND_TX_HASH as `0x${string}`);
      } else if (refundResult === 'pending') {
        vi.mocked(contractRefundOrphanedPayment).mockRejectedValue(
          new ServerTransactionPendingError(REFUND_TX_HASH as `0x${string}`, 7)
        );
      } else {
        vi.mocked(contractRefundOrphanedPayment).mockRejectedValue(new Error('out of gas'));
      }
      try {
        await handlePostPaymentFailure({
          db: db as any,
          payer: PAYER as `0x${string}`,
          amount: 1000n,
          paymentTxHash: PAYMENT_TX_HASH as `0x${string}`,
          context: 'tasks.create',
          error: new Error(message),
        });
      } catch (error) {
        return error;
      }
      throw new Error('handlePostPaymentFailure must always throw');
    }

    it('reports a failed refund even when the revert reason contains the word refunded', async () => {
      // `failureMessage` is a decoded revert reason and `tasks.refundExpired` is a live
      // operation, so a revert that says "refunded" is reachable, not hypothetical.
      // The message is operator-controlled: `failureMessage` is a decoded revert reason, and
      // `tasks.refundExpired` is a live operation, so a revert named like AlreadyRefunded is
      // reachable. String-matching read this as a success and logged nothing.
      const error = await failureFrom('failed', 'execution reverted: already refunded');
      // The old test -- `!message.includes('refunded')` -- is false here, which is exactly the
      // silence being fixed. The structured answer disagrees, and it is the one that is right.
      expect((error as Error).message.includes('refunded')).toBe(true);
      expect((error as Error).message).toContain('could not be completed');
      expect(refundDidNotComplete(error)).toBe(true);
    });

    it('reports a completed refund as complete', async () => {
      expect(refundDidNotComplete(await failureFrom('ok', 'boom'))).toBe(false);
    });

    it('does not report an in-flight refund as a failure', async () => {
      expect(refundDidNotComplete(await failureFrom('pending', 'boom'))).toBe(false);
    });

    it('is false for anything that never reached a refund at all', () => {
      expect(refundDidNotComplete(new Error('unrelated'))).toBe(false);
    });
  });

  describe('handleStandardFeePostPaymentFailure', () => {
    it('refunds exactly the flat STANDARD_X402_ACTION_AMOUNT, not a caller-supplied amount', async () => {
      const db = makeFakeDb();
      db.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
      db.update.mockReturnValueOnce(updateChain([{ id: 'x' }])).mockReturnValueOnce(updateChain());
      vi.mocked(contractRefundOrphanedPayment).mockResolvedValue(REFUND_TX_HASH as `0x${string}`);

      await expect(
        handleStandardFeePostPaymentFailure({
          db: db as any,
          payer: PAYER as `0x${string}`,
          paymentTxHash: PAYMENT_TX_HASH as `0x${string}`,
          context: 'task_cancel',
          error: new Error('boom'),
        })
      ).rejects.toBeInstanceOf(TRPCError);

      expect(contractRefundOrphanedPayment).toHaveBeenCalledWith(PAYER, 1000n);
    });
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import { makeChain } from '../helpers';

vi.mock('../../../src/services/contract', () => ({
  contractRefundOrphanedPayment: vi.fn(),
}));

import {
  recordAndRefundOrphanedPayment,
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

      expect(result).toEqual({ refunded: true, refundTxHash: REFUND_TX_HASH });
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

      expect(result).toEqual({ refunded: false, refundTxHash: null });
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

      expect(result).toEqual({ refunded: false, refundTxHash: null });
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

// Verifies: ADR-0035
// Verifies: ADR-0037
import { describe, expect, it, vi } from 'vitest';
import { makeChain } from '../helpers';
import { HARD_SUBMISSION_CEILING } from '../../../src/config/payments';
import {
  FREE_SUBMISSION_ALLOWANCE,
  HARD_CEILING_MESSAGE,
  assertUnderHardSubmissionCeilingForInsert,
  countSuccessfulSubmissions,
  isOverHardSubmissionCeiling,
  isWithinFreeSubmissionAllowance,
} from '../../../src/services/submission-allowance';

const TASK_ID = '0xtask0000000000000000000000000000000001';
const WORKER = '0xWorker0000000000000000000000000000000001';

function dbReturning(count: number) {
  return {
    select: () => makeChain([{ value: count }]),
  } as never;
}

describe('submission-allowance', () => {
  describe('countSuccessfulSubmissions', () => {
    it('returns the row count from the submissions table', async () => {
      const result = await countSuccessfulSubmissions(dbReturning(5), TASK_ID, WORKER);
      expect(result).toBe(5);
    });

    it('returns 0 when the query yields no rows', async () => {
      const db = { select: () => makeChain([]) } as never;
      const result = await countSuccessfulSubmissions(db, TASK_ID, WORKER);
      expect(result).toBe(0);
    });
  });

  describe('isWithinFreeSubmissionAllowance', () => {
    it('is true below the allowance (0-indexed: prior count < allowance)', async () => {
      const db = dbReturning(FREE_SUBMISSION_ALLOWANCE - 1);
      await expect(isWithinFreeSubmissionAllowance(db, TASK_ID, WORKER)).resolves.toBe(true);
    });

    it('is false exactly at the allowance -- the Nth submission was the last free one', async () => {
      const db = dbReturning(FREE_SUBMISSION_ALLOWANCE);
      await expect(isWithinFreeSubmissionAllowance(db, TASK_ID, WORKER)).resolves.toBe(false);
    });

    it('is false above the allowance', async () => {
      const db = dbReturning(FREE_SUBMISSION_ALLOWANCE + 5);
      await expect(isWithinFreeSubmissionAllowance(db, TASK_ID, WORKER)).resolves.toBe(false);
    });

    it('is true with zero prior submissions (first submission is always free)', async () => {
      const db = dbReturning(0);
      await expect(isWithinFreeSubmissionAllowance(db, TASK_ID, WORKER)).resolves.toBe(true);
    });
  });

  // RFC-0006 Tier 2 (ADR-0037): case 10 in
  // docs/specs/submission-tier-2-hard-ceiling.md's Testing & Verification -- a thin-wrapper
  // test only; the 3 boundary cases (below/at/above the ceiling) are covered against the
  // shared `isOverFixedCeiling` directly in apps/backend/test/unit/lib/rate-limit.test.ts.
  describe('isOverHardSubmissionCeiling', () => {
    it('delegates to isOverFixedCeiling with HARD_SUBMISSION_CEILING and countSuccessfulSubmissions as the count source', async () => {
      const selectSpy = vi.fn(() => makeChain([{ value: HARD_SUBMISSION_CEILING }]));
      const db = { select: selectSpy } as never;

      const result = await isOverHardSubmissionCeiling(db, TASK_ID, WORKER);

      expect(result).toBe(true);
      // Confirms the count source really is countSuccessfulSubmissions (a `select`
      // against the `submissions` table), not a hand-rolled query.
      expect(selectSpy).toHaveBeenCalledTimes(1);
    });

    it('is false below the ceiling and true above it', async () => {
      const below = { select: () => makeChain([{ value: HARD_SUBMISSION_CEILING - 1 }]) } as never;
      const above = { select: () => makeChain([{ value: HARD_SUBMISSION_CEILING + 1 }]) } as never;

      await expect(isOverHardSubmissionCeiling(below, TASK_ID, WORKER)).resolves.toBe(false);
      await expect(isOverHardSubmissionCeiling(above, TASK_ID, WORKER)).resolves.toBe(true);
    });
  });

  // Code review finding: submissionAllowanceGate's own hard-ceiling check runs in
  // middleware, before uploads and the on-chain call -- concurrent requests could all
  // read the same under-ceiling count and all proceed. assertUnderHardSubmissionCeilingForInsert
  // re-validates atomically, inside the same transaction as the actual insert.
  describe('assertUnderHardSubmissionCeilingForInsert', () => {
    function mockTx(count: number) {
      return {
        select: () => makeChain([{ value: count }]),
        execute: vi.fn().mockResolvedValue([]),
      } as never;
    }

    it('acquires a transaction-scoped advisory lock before re-checking the count', async () => {
      const executeSpy = vi.fn().mockResolvedValue([]);
      const tx = { select: () => makeChain([{ value: 0 }]), execute: executeSpy } as never;

      await assertUnderHardSubmissionCeilingForInsert(tx, TASK_ID, WORKER);

      expect(executeSpy).toHaveBeenCalledOnce();
      const [query] = executeSpy.mock.calls[0]!;
      expect(JSON.stringify(query)).toContain('pg_advisory_xact_lock');
    });

    it('resolves without throwing when under the ceiling', async () => {
      const tx = mockTx(HARD_SUBMISSION_CEILING - 1);
      await expect(
        assertUnderHardSubmissionCeilingForInsert(tx, TASK_ID, WORKER)
      ).resolves.toBeUndefined();
    });

    it('throws a TOO_MANY_REQUESTS TRPCError at exactly the ceiling', async () => {
      const tx = mockTx(HARD_SUBMISSION_CEILING);
      await expect(assertUnderHardSubmissionCeilingForInsert(tx, TASK_ID, WORKER)).rejects.toMatchObject(
        { code: 'TOO_MANY_REQUESTS', message: HARD_CEILING_MESSAGE }
      );
    });

    it('throws above the ceiling too -- the ceiling stays closed, not just the boundary', async () => {
      const tx = mockTx(HARD_SUBMISSION_CEILING + 3);
      await expect(
        assertUnderHardSubmissionCeilingForInsert(tx, TASK_ID, WORKER)
      ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    });
  });
});

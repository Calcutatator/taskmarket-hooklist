// Verifies: ADR-0038
import { describe, expect, it, vi } from 'vitest';
import { taskAccessPasswordRateLimits, taskDropSubscribeRateLimits } from '../../../src/db/schema';
import {
  consumeSlidingWindowAttempt,
  isOverFixedCeiling,
  type SlidingWindowTable,
} from '../../../src/lib/rate-limit';

const DB = {} as never;

/**
 * A minimal fake transaction reproducing the exact chain shape
 * `consumeSlidingWindowAttempt` uses (insert -> values -> onConflictDoUpdate ->
 * returning), with in-memory sliding-window semantics matching the real SQL CASE
 * expression -- same approach as
 * apps/backend/test/unit/lib/task-access-password.test.ts's `makeFakeRateLimitDb`, but
 * keyed per-table (a `Map` per table object) so case 9 (two different `table` values
 * targeting genuinely different storage) can be verified directly.
 */
function makeFakeTx(now: () => Date = () => new Date()) {
  const storeByTable = new WeakMap<
    SlidingWindowTable,
    Map<string, { attempts: number; windowStartedAt: Date }>
  >();

  function storeFor(table: SlidingWindowTable) {
    let store = storeByTable.get(table);
    if (!store) {
      store = new Map();
      storeByTable.set(table, store);
    }
    return store;
  }

  const tx = {
    insert: (table: SlidingWindowTable) => ({
      values: (row: { key: string; windowStartedAt: Date }) => ({
        onConflictDoUpdate: () => ({
          returning: async () => {
            const store = storeFor(table);
            const nowValue = now();
            const existing = store.get(row.key);
            const windowElapsedMs = existing
              ? nowValue.getTime() - existing.windowStartedAt.getTime()
              : 0;
            const windowExpired = existing !== undefined && windowElapsedMs > 60 * 60 * 1000;

            if (!existing || windowExpired) {
              store.set(row.key, { attempts: 1, windowStartedAt: nowValue });
            } else {
              store.set(row.key, {
                attempts: existing.attempts + 1,
                windowStartedAt: existing.windowStartedAt,
              });
            }
            return [{ attempts: store.get(row.key)!.attempts }];
          },
        }),
      }),
    }),
  };

  return tx as never;
}

describe('isOverFixedCeiling', () => {
  it('is false below the ceiling', async () => {
    const count = vi.fn().mockResolvedValue(4);
    await expect(isOverFixedCeiling(DB, { count, ceiling: 5 })).resolves.toBe(false);
  });

  it('is true at exactly the ceiling', async () => {
    const count = vi.fn().mockResolvedValue(5);
    await expect(isOverFixedCeiling(DB, { count, ceiling: 5 })).resolves.toBe(true);
  });

  it('is true above the ceiling', async () => {
    const count = vi.fn().mockResolvedValue(6);
    await expect(isOverFixedCeiling(DB, { count, ceiling: 5 })).resolves.toBe(true);
  });

  it('calls count() exactly once per invocation', async () => {
    const count = vi.fn().mockResolvedValue(0);
    await isOverFixedCeiling(DB, { count, ceiling: 5 });
    expect(count).toHaveBeenCalledTimes(1);
  });
});

describe('consumeSlidingWindowAttempt', () => {
  it('returns { attempts: 1, overLimit: false } on a fresh key', async () => {
    const tx = makeFakeTx();
    const result = await consumeSlidingWindowAttempt(tx, {
      table: taskDropSubscribeRateLimits,
      key: 'fresh-key',
      windowSeconds: 3600,
      limit: 3,
    });
    expect(result).toEqual({ attempts: 1, overLimit: false });
  });

  it('increments attempts and returns overLimit: false on repeated calls within the window, up to and including exactly the limit', async () => {
    const tx = makeFakeTx();
    const params = {
      table: taskDropSubscribeRateLimits,
      key: 'within-window',
      windowSeconds: 3600,
      limit: 3,
    };

    const first = await consumeSlidingWindowAttempt(tx, params);
    expect(first).toEqual({ attempts: 1, overLimit: false });

    const second = await consumeSlidingWindowAttempt(tx, params);
    expect(second).toEqual({ attempts: 2, overLimit: false });

    const third = await consumeSlidingWindowAttempt(tx, params);
    expect(third).toEqual({ attempts: 3, overLimit: false });
  });

  it('returns overLimit: true on the call that pushes attempts past the limit, within the window', async () => {
    const tx = makeFakeTx();
    const params = {
      table: taskDropSubscribeRateLimits,
      key: 'over-limit',
      windowSeconds: 3600,
      limit: 3,
    };

    for (let i = 0; i < 3; i++) {
      await consumeSlidingWindowAttempt(tx, params);
    }
    const fourth = await consumeSlidingWindowAttempt(tx, params);
    expect(fourth).toEqual({ attempts: 4, overLimit: true });
  });

  it('resets attempts to 1 and overLimit: false on a call after windowSeconds has elapsed', async () => {
    let current = new Date('2026-01-01T00:00:00.000Z');
    const tx = makeFakeTx(() => current);
    const params = {
      table: taskDropSubscribeRateLimits,
      key: 'window-reset',
      windowSeconds: 3600,
      limit: 3,
    };

    const first = await consumeSlidingWindowAttempt(tx, params);
    expect(first).toEqual({ attempts: 1, overLimit: false });

    for (let i = 0; i < 3; i++) {
      current = new Date(current.getTime() + 60 * 1000);
      await consumeSlidingWindowAttempt(tx, params);
    }
    // 4 attempts recorded so far, still within the 1-hour window -- confirms the setup
    // actually reached an over-limit state before testing the reset below.
    current = new Date(current.getTime() + 60 * 1000);
    const overLimit = await consumeSlidingWindowAttempt(tx, params);
    expect(overLimit.overLimit).toBe(true);

    // Advance past the 1-hour window from the original windowStartedAt.
    current = new Date(current.getTime() + 61 * 60 * 1000);
    const afterReset = await consumeSlidingWindowAttempt(tx, params);
    expect(afterReset).toEqual({ attempts: 1, overLimit: false });
  });

  it('targets the right table, not a hardcoded one, when called against two different table values', async () => {
    const tx = makeFakeTx();
    const sameKey = 'shared-key';

    const dropResult = await consumeSlidingWindowAttempt(tx, {
      table: taskDropSubscribeRateLimits,
      key: sameKey,
      windowSeconds: 3600,
      limit: 10,
    });
    expect(dropResult).toEqual({ attempts: 1, overLimit: false });

    // Same key, different table -- if the implementation hardcoded one table this
    // would come back as attempts: 2 (sharing the drop-subscribe counter) instead of
    // starting fresh at 1 in its own, independent counter.
    const passwordResult = await consumeSlidingWindowAttempt(tx, {
      table: taskAccessPasswordRateLimits,
      key: sameKey,
      windowSeconds: 3600,
      limit: 10,
    });
    expect(passwordResult).toEqual({ attempts: 1, overLimit: false });

    const dropResultAgain = await consumeSlidingWindowAttempt(tx, {
      table: taskDropSubscribeRateLimits,
      key: sameKey,
      windowSeconds: 3600,
      limit: 10,
    });
    expect(dropResultAgain).toEqual({ attempts: 2, overLimit: false });
  });
});

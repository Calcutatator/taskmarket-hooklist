import { describe, it, expect, vi } from 'vitest';
import { enforceTaskDropSubscribeRateLimit } from '../../../src/services/task-drop-subscribe-rate-limit';
import { makeChain } from '../helpers';

/**
 * Builds a mock db whose transaction runs the callback with itself as `tx`.
 * `insert(...).values(...).onConflictDoUpdate(...).returning()` resolves to the
 * queued attempt counts in order: first the email counter, then the client counter.
 */
function makeDb(...returningRows: Array<Array<{ attempts: number }>>) {
  const insert = vi.fn();
  for (const rows of returningRows) {
    insert.mockReturnValueOnce(makeChain(rows));
  }
  const db: any = {
    insert,
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(db)),
  };
  return db;
}

const input = (db: any) => ({
  clientAddress: '0xClient',
  db,
  email: 'user@example.com',
});

describe('enforceTaskDropSubscribeRateLimit', () => {
  it('resolves when both the email and client counters are under their limits', async () => {
    const db = makeDb([{ attempts: 1 }], [{ attempts: 1 }]);
    await expect(enforceTaskDropSubscribeRateLimit(input(db))).resolves.toBeUndefined();
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(db.insert).toHaveBeenCalledTimes(2);
  });

  it('allows the email counter at exactly its limit (3)', async () => {
    const db = makeDb([{ attempts: 3 }], [{ attempts: 1 }]);
    await expect(enforceTaskDropSubscribeRateLimit(input(db))).resolves.toBeUndefined();
  });

  it('rejects once the email counter exceeds its limit (4)', async () => {
    const db = makeDb([{ attempts: 4 }]);
    await expect(enforceTaskDropSubscribeRateLimit(input(db))).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    });
    // Short-circuits before consuming the client counter.
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it('allows the client counter at exactly its limit (10)', async () => {
    const db = makeDb([{ attempts: 1 }], [{ attempts: 10 }]);
    await expect(enforceTaskDropSubscribeRateLimit(input(db))).resolves.toBeUndefined();
  });

  it('rejects once the client counter exceeds its limit (11)', async () => {
    const db = makeDb([{ attempts: 1 }], [{ attempts: 11 }]);
    await expect(enforceTaskDropSubscribeRateLimit(input(db))).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    });
    expect(db.insert).toHaveBeenCalledTimes(2);
  });

  it('throws when the upsert records no row', async () => {
    const db = makeDb([]);
    await expect(enforceTaskDropSubscribeRateLimit(input(db))).rejects.toThrow(
      'Subscription rate limit could not be recorded'
    );
  });
});

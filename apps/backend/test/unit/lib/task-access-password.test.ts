import { describe, expect, it } from 'vitest';
import {
  hashTaskAccessPassword,
  verifyTaskAccessPassword,
  verifyOrDummyTaskAccessPassword,
  enforceTaskAccessPasswordRateLimit,
} from '../../../src/lib/task-access-password';

describe('hashTaskAccessPassword / verifyTaskAccessPassword', () => {
  it('round-trips a correct password', () => {
    const hash = hashTaskAccessPassword('correct horse battery staple');
    expect(verifyTaskAccessPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects a wrong password', () => {
    const hash = hashTaskAccessPassword('correct horse battery staple');
    expect(verifyTaskAccessPassword('wrong password', hash)).toBe(false);
  });

  it('produces a different hash (different salt) for the same password each time', () => {
    const a = hashTaskAccessPassword('same password');
    const b = hashTaskAccessPassword('same password');
    expect(a).not.toBe(b);
    expect(verifyTaskAccessPassword('same password', a)).toBe(true);
    expect(verifyTaskAccessPassword('same password', b)).toBe(true);
  });

  it('rejects a malformed stored hash instead of throwing', () => {
    expect(verifyTaskAccessPassword('anything', 'not-a-real-hash')).toBe(false);
    expect(verifyTaskAccessPassword('anything', 'scrypt:onlyonepart')).toBe(false);
    expect(verifyTaskAccessPassword('anything', 'md5:deadbeef:deadbeef')).toBe(false);
  });
});

describe('verifyOrDummyTaskAccessPassword', () => {
  it('verifies against the real stored hash when one exists', () => {
    const hash = hashTaskAccessPassword('hunter22');
    expect(verifyOrDummyTaskAccessPassword('hunter22', hash)).toBe(true);
    expect(verifyOrDummyTaskAccessPassword('wrong', hash)).toBe(false);
  });

  it('always returns false when no password is set, without throwing', () => {
    expect(verifyOrDummyTaskAccessPassword('anything', null)).toBe(false);
  });

  it('takes roughly the same time for "no password set" and "wrong password" (no fast short-circuit)', () => {
    const hash = hashTaskAccessPassword('hunter22');
    const start1 = process.hrtime.bigint();
    verifyOrDummyTaskAccessPassword('wrong-guess', hash);
    const wrongPasswordMs = Number(process.hrtime.bigint() - start1) / 1e6;

    const start2 = process.hrtime.bigint();
    verifyOrDummyTaskAccessPassword('wrong-guess', null);
    const noPasswordMs = Number(process.hrtime.bigint() - start2) / 1e6;

    // Both paths run a real scrypt comparison, so neither should be near-instant
    // relative to the other -- a regression that reintroduces a fast short-circuit
    // for the "no password" case would make noPasswordMs collapse toward 0 while
    // wrongPasswordMs stays at scrypt cost. Generous bound to avoid CI flakiness.
    expect(noPasswordMs).toBeGreaterThan(wrongPasswordMs * 0.2);
  });
});

// Minimal fake db reproducing the exact chain shape
// enforceTaskAccessPasswordRateLimit's transaction callback uses
// (insert -> values -> onConflictDoUpdate -> returning), with in-memory
// sliding-window semantics matching the real SQL CASE expression.
function makeFakeRateLimitDb() {
  const rows = new Map<string, { attempts: number; windowStartedAt: Date }>();

  const db = {
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(tx),
  };

  const tx = {
    insert: () => ({
      values: (row: { key: string; attempts: number; windowStartedAt: Date }) => ({
        onConflictDoUpdate: () => ({
          returning: async () => {
            const now = row.windowStartedAt;
            const existing = rows.get(row.key);
            const windowExpired =
              existing && now.getTime() - existing.windowStartedAt.getTime() > 60 * 60 * 1000;
            if (!existing || windowExpired) {
              rows.set(row.key, { attempts: 1, windowStartedAt: now });
            } else {
              rows.set(row.key, { attempts: existing.attempts + 1, windowStartedAt: existing.windowStartedAt });
            }
            return [{ attempts: rows.get(row.key)!.attempts }];
          },
        }),
      }),
    }),
  };

  return db;
}

describe('enforceTaskAccessPasswordRateLimit', () => {
  it('allows attempts up to the limit, then throws for the same task', async () => {
    const db = makeFakeRateLimitDb() as Parameters<typeof enforceTaskAccessPasswordRateLimit>[0]['db'];

    for (let i = 0; i < 10; i++) {
      await expect(
        enforceTaskAccessPasswordRateLimit({ db, taskId: 'task-1' })
      ).resolves.toBeUndefined();
    }

    await expect(enforceTaskAccessPasswordRateLimit({ db, taskId: 'task-1' })).rejects.toThrow(
      'Too many attempts'
    );
  });

  it('rate-limits each task independently', async () => {
    const db = makeFakeRateLimitDb() as Parameters<typeof enforceTaskAccessPasswordRateLimit>[0]['db'];

    for (let i = 0; i < 10; i++) {
      await enforceTaskAccessPasswordRateLimit({ db, taskId: 'task-a' });
    }
    await expect(enforceTaskAccessPasswordRateLimit({ db, taskId: 'task-a' })).rejects.toThrow();

    // A different task's counter is unaffected.
    await expect(
      enforceTaskAccessPasswordRateLimit({ db, taskId: 'task-b' })
    ).resolves.toBeUndefined();
  });
});

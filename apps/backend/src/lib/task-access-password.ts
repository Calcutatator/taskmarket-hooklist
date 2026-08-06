import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import type { db as DbType } from '../db/client';
import { taskAccessPasswordRateLimits } from '../db/schema';
import { SlidingWindowRecordError, consumeSlidingWindowAttempt } from './rate-limit';

type Db = Pick<typeof DbType, 'select' | 'insert' | 'transaction'>;

const SCRYPT_KEYLEN = 64;

// OWASP Password Storage Cheat Sheet minimum work factor for scrypt (N=2^17, r=8, p=1).
// Node's own default (N=16384) is roughly 1/8th of this. maxmem must cover 128*N*r bytes.
export const SCRYPT_N = 2 ** 17;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;
const SCRYPT_OPTIONS = { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM };

// Hashes created before this cost factor was raised have no explicit N recorded and were
// all produced with Node's scrypt default -- kept only so those hashes keep verifying.
const LEGACY_SCRYPT_N = 16384;

/**
 * A human-chosen password needs a salted, slow hash -- unlike the rest of this codebase's
 * `sha256Hex` (lib/hash.ts), which is only ever applied to already-high-entropy random
 * tokens (API tokens, legal/task-access receipts). Node's built-in scrypt avoids adding a
 * new dependency. The cost factor is recorded alongside the hash so it can be raised again
 * later without invalidating hashes created under an older, lower cost factor.
 */
export function hashTaskAccessPassword(password: string): string {
  return hashWithSalt(password, randomBytes(16));
}

function hashWithSalt(password: string, salt: Buffer): string {
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS);
  return `scrypt:${SCRYPT_N}:${salt.toString('hex')}:${hash.toString('hex')}`;
}

/**
 * The same hash, with its salt derived from `saltSeed` instead of drawn at random.
 *
 * For the one caller that has to produce a byte-identical hash twice: a relayed write hashes
 * the password on the request path so no plaintext is ever persisted, and the resulting hash
 * goes into the intent payload -- which ADR-0061 compares verbatim to tell an honest retry
 * from a caller changing their arguments. A random salt makes every attempt a different
 * payload, so the second attempt at one creation would be refused as a payload mismatch.
 *
 * A salt does not have to be secret or random, only unique per stored hash, which is what it
 * buys: no two records share a hash and no precomputed table covers them. Seeding it from the
 * caller's own per-operation idempotency key keeps that property -- the seed is unique per
 * creation -- while making the derivation reproducible. The seed is never the password and
 * never derived from it, so nothing about the password leaks into the salt.
 *
 * The one property this gives up against a random salt: the salt is predictable to anyone who
 * learns the idempotency key, and that key is not a secret -- it travels in a header, is stored,
 * and may turn up in logs. Someone holding it can start precomputing candidates against this one
 * salt before the password is even chosen. That was weighed and accepted: uniqueness, the thing a
 * salt is actually for, still holds; scrypt at this cost factor makes each precomputed candidate
 * expensive rather than free; and the work buys the attacker one task's password and nothing else,
 * so it never amortises the way a shared or absent salt would. Closing it would mean drawing the
 * salt at random and carrying it in the intent payload so retries reproduce it -- a payload field
 * and a migration path for hashes already stored, for a narrowing of an attack that is per-task
 * and still has to pay scrypt for every guess.
 */
export function hashTaskAccessPasswordWithDerivedSalt(password: string, saltSeed: string): string {
  const salt = createHash('sha256').update(`task-access-password-salt:${saltSeed}`).digest();
  return hashWithSalt(password, salt.subarray(0, 16));
}

// A fixed, valid-shaped hash used only to keep the "no password set" and "wrong password"
// code paths taking the same amount of time -- see verifyOrDummyTaskAccessPassword below.
const DUMMY_STORED_HASH = hashTaskAccessPassword('taskmarket-dummy-constant-time-comparison');

export function verifyTaskAccessPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  let n: number;
  let saltHex: string;
  let hashHex: string;
  if (parts.length === 4 && parts[0] === 'scrypt') {
    n = Number(parts[1]);
    saltHex = parts[2];
    hashHex = parts[3];
  } else if (parts.length === 3 && parts[0] === 'scrypt') {
    n = LEGACY_SCRYPT_N;
    saltHex = parts[1];
    hashHex = parts[2];
  } else {
    return false;
  }
  if (!Number.isInteger(n) || n < 2) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, 'hex');
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  if (expected.length === 0) return false;
  const actual = scryptSync(password, salt, expected.length, {
    ...SCRYPT_OPTIONS,
    N: n,
  });
  return timingSafeEqual(actual, expected);
}

/**
 * Verifies `password` against `stored` when a password is actually set on the task;
 * otherwise runs the same comparison against a dummy hash and always returns false. Both
 * branches always execute a real scrypt comparison, so "this task has no password" and
 * "this task has a password but it's wrong" take roughly the same time -- avoids a timing
 * side-channel that would otherwise let a caller distinguish the two cases from latency
 * alone.
 */
export function verifyOrDummyTaskAccessPassword(password: string, stored: string | null): boolean {
  if (stored) return verifyTaskAccessPassword(password, stored);
  verifyTaskAccessPassword(password, DUMMY_STORED_HASH);
  return false;
}

const LIMIT_PER_TASK = 10;
const WINDOW_SECONDS = 60 * 60;

function rateLimitKey(taskId: string): string {
  return createHash('sha256').update(`task-access-password:${taskId}`).digest('hex');
}

/**
 * Implements: ADR-0038
 * Throttles `taskAccess.verifyPassword` per task, mirroring
 * `enforceTaskDropSubscribeRateLimit`'s DB-backed sliding-window shape exactly (same
 * upsert-inside-a-transaction pattern) -- without this, an unauthenticated caller could
 * brute-force a private task's password with unlimited attempts. Migrated onto the shared
 * `consumeSlidingWindowAttempt` (apps/backend/src/lib/rate-limit.ts) -- same table, same
 * 1-hour window, same limit, same error shape as before. See
 * docs/specs/submission-tier-2-hard-ceiling.md "Migrating the existing rate limiters".
 */
export async function enforceTaskAccessPasswordRateLimit(input: {
  db: Db;
  taskId: string;
}): Promise<void> {
  const key = rateLimitKey(input.taskId);

  await input.db.transaction(async (tx) => {
    let attempts: number;
    try {
      ({ attempts } = await consumeSlidingWindowAttempt(tx, {
        table: taskAccessPasswordRateLimits,
        key,
        windowSeconds: WINDOW_SECONDS,
        limit: LIMIT_PER_TASK,
      }));
    } catch (err) {
      if (err instanceof SlidingWindowRecordError) {
        throw new Error('Task access password rate limit could not be recorded');
      }
      throw err;
    }

    if (attempts > LIMIT_PER_TASK) {
      const err = new Error('Too many attempts. Try again later.');
      err.name = 'TASK_ACCESS_RATE_LIMITED';
      throw err;
    }
  });
}

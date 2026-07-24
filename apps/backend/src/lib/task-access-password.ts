import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { sql } from 'drizzle-orm';
import type { db as DbType } from '../db/client';
import { taskAccessPasswordRateLimits } from '../db/schema';

type Db = Pick<typeof DbType, 'select' | 'insert' | 'transaction'>;

const SCRYPT_KEYLEN = 64;

/**
 * A human-chosen password needs a salted, slow hash -- unlike the rest of this codebase's
 * `sha256Hex` (lib/hash.ts), which is only ever applied to already-high-entropy random
 * tokens (API tokens, legal/task-access receipts). Node's built-in scrypt avoids adding a
 * new dependency.
 */
export function hashTaskAccessPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

// A fixed, valid-shaped hash used only to keep the "no password set" and "wrong password"
// code paths taking the same amount of time -- see verifyOrDummyTaskAccessPassword below.
const DUMMY_STORED_HASH = hashTaskAccessPassword('taskmarket-dummy-constant-time-comparison');

export function verifyTaskAccessPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, saltHex, hashHex] = parts;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, 'hex');
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  if (expected.length === 0) return false;
  const actual = scryptSync(password, salt, expected.length);
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

const RATE_LIMIT_WINDOW_SQL = sql`CURRENT_TIMESTAMP - INTERVAL '1 hour'`;
const LIMIT_PER_TASK = 10;

function rateLimitKey(taskId: string): string {
  return createHash('sha256').update(`task-access-password:${taskId}`).digest('hex');
}

/**
 * Throttles `taskAccess.verifyPassword` per task, mirroring
 * `enforceTaskDropSubscribeRateLimit`'s DB-backed sliding-window shape exactly (same
 * upsert-inside-a-transaction pattern) -- without this, an unauthenticated caller could
 * brute-force a private task's password with unlimited attempts.
 */
export async function enforceTaskAccessPasswordRateLimit(input: {
  db: Db;
  taskId: string;
}): Promise<void> {
  const now = new Date();
  const key = rateLimitKey(input.taskId);

  await input.db.transaction(async (tx) => {
    const rows = await tx
      .insert(taskAccessPasswordRateLimits)
      .values({ attempts: 1, key, updatedAt: now, windowStartedAt: now })
      .onConflictDoUpdate({
        target: taskAccessPasswordRateLimits.key,
        set: {
          attempts: sql`CASE
            WHEN ${taskAccessPasswordRateLimits.windowStartedAt} <= ${RATE_LIMIT_WINDOW_SQL} THEN 1
            ELSE ${taskAccessPasswordRateLimits.attempts} + 1
          END`,
          updatedAt: now,
          windowStartedAt: sql`CASE
            WHEN ${taskAccessPasswordRateLimits.windowStartedAt} <= ${RATE_LIMIT_WINDOW_SQL}
              THEN CURRENT_TIMESTAMP
            ELSE ${taskAccessPasswordRateLimits.windowStartedAt}
          END`,
        },
      })
      .returning({ attempts: taskAccessPasswordRateLimits.attempts });

    const attempts = rows[0]?.attempts;
    if (attempts === undefined) {
      throw new Error('Task access password rate limit could not be recorded');
    }
    if (attempts > LIMIT_PER_TASK) {
      const err = new Error('Too many attempts. Try again later.');
      err.name = 'TASK_ACCESS_RATE_LIMITED';
      throw err;
    }
  });
}

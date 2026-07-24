import { randomBytes, randomUUID } from 'crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { db as DbType } from '../db/client';
import { taskAccessGrants } from '../db/schema';
import { sha256Hex } from './hash';

type Db = Pick<typeof DbType, 'select' | 'insert' | 'update'>;

// 24h -- long enough a caller isn't forced to re-enter the password constantly, short
// enough a leaked grant isn't a permanent bearer secret. Scoped to exactly one taskId (see
// verifyTaskAccessGrant below), so a leaked grant only ever exposes the one task it was
// issued for.
const GRANT_TTL_MS = 24 * 60 * 60 * 1000;

export type ResolvedTaskAccessGrant = { taskId: string };

/**
 * Mirrors services/legal.ts's issueLegalReceipt/verifyLegalReceipt pair exactly: an
 * opaque, stateful bearer receipt (random token, hashed at rest, revocable, lastUsedAt
 * tracked) rather than a stateless HMAC-signed token -- see ADR-0030 for why that's the
 * chosen shape (trivially revocable/auditable, no new server secret to manage).
 */
export async function issueTaskAccessGrant(
  db: Db,
  taskId: string,
  now = new Date()
): Promise<{ grant: string; expiresAt: Date }> {
  const grant = `tmtpa_${randomBytes(32).toString('base64url')}`; // Taskmarket Task Private Access
  const expiresAt = new Date(now.getTime() + GRANT_TTL_MS);
  await db.insert(taskAccessGrants).values({
    id: randomUUID(),
    taskId,
    tokenHash: sha256Hex(grant),
    expiresAt,
  });
  return { grant, expiresAt };
}

export async function verifyTaskAccessGrant(
  db: Db,
  token: string
): Promise<ResolvedTaskAccessGrant | null> {
  if (!token || token.length > 256) return null;
  const now = new Date();
  const rows = await db
    .select()
    .from(taskAccessGrants)
    .where(
      and(
        eq(taskAccessGrants.tokenHash, sha256Hex(token)),
        gt(taskAccessGrants.expiresAt, now),
        isNull(taskAccessGrants.revokedAt)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  // Fire-and-forget, matches verifyLegalReceipt -- a read shouldn't block on this write.
  void db.update(taskAccessGrants).set({ lastUsedAt: now }).where(eq(taskAccessGrants.id, row.id));

  return { taskId: row.taskId };
}

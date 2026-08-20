// Implements: ADR-0098. Minting belongs to the row insert rather than to any one caller, because a
// task row is written either by the intent completion that observed the receipt (ADR-0055) or by a
// later reconciliation pass over the same TaskCreated event (ADR-0029), and exactly one of them
// must produce the code.

import { eq } from 'drizzle-orm';

import type { db as DbType } from '../db/client';
import { submissions, tasks } from '../db/schema';
import { logger } from '../lib/logger';
import { mintReferenceCode, type ReferenceEntity } from '../lib/reference-codes';

/**
 * Any drizzle handle -- the root client or a transaction. Minting reads before the insert it feeds,
 * so it must be able to run inside the caller's transaction rather than opening its own.
 */
type Database = Pick<typeof DbType, 'select'>;

/**
 * How many times to redraw before giving up. At 32^8 (~1.1e12) a collision is already vanishingly
 * unlikely, so reaching the end of this loop means something is wrong with the draw itself rather
 * than that we were unlucky -- and failing loudly is the right answer to that.
 */
const MAX_ATTEMPTS = 5;

type MintContext = {
  db: Database;
  entity: ReferenceEntity;
};

/**
 * Draw a reference code that is not already taken.
 *
 * The pre-check is not the uniqueness guarantee -- the unique index is, and a concurrent insert can
 * still lose a race with it. The pre-check exists so that losing that race is astronomically rare
 * rather than merely very rare, because the insert sites use `onConflictDoNothing` targeted at the
 * primary key: a code collision surfaces there as a real error, which is what we want, but it is
 * still an error nobody should ever have to see.
 */
export async function mintUniqueReferenceCode(context: MintContext): Promise<string> {
  const { db, entity } = context;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const candidate = mintReferenceCode(entity);

    const existing =
      entity === 'submission'
        ? await db
            .select({ code: submissions.referenceCode })
            .from(submissions)
            .where(eq(submissions.referenceCode, candidate))
            .limit(1)
        : await db
            .select({ code: tasks.referenceCode })
            .from(tasks)
            .where(eq(tasks.referenceCode, candidate))
            .limit(1);

    if (existing.length === 0) {
      return candidate;
    }

    logger.warn(`Reference code collision for ${entity} on attempt ${attempt + 1}; redrawing`);
  }

  throw new Error(
    `Could not mint a unique ${entity} reference code after ${MAX_ATTEMPTS} attempts. ` +
      'This indicates a defect in the code generator rather than bad luck.'
  );
}

// Implements: ADR-0098. The operational step between migration 0051 (add the nullable columns)
// and the follow-up that makes them NOT NULL -- the same two-deploy shape as ADR-0008.
//
// This cannot be inline SQL in the migration. A code needs the same CSPRNG draw and
// retry-on-collision behaviour as the write path, and a single statement over the whole table
// would hold a lock for its duration. So it batches, and it only ever touches rows whose code is
// still null, which is what makes re-running it a no-op rather than a rewrite.

import { isNull, sql } from 'drizzle-orm';

import { db } from '../db/client';
import { submissions, tasks } from '../db/schema';
import { logger } from '../lib/logger';
import { mintReferenceCode, type ReferenceEntity } from '../lib/reference-codes';

const BATCH_SIZE = 500;

export type BackfillReport = {
  entity: ReferenceEntity;
  scanned: number;
  assigned: number;
  collisions: number;
};

async function backfillEntity(entity: ReferenceEntity): Promise<BackfillReport> {
  const table = entity === 'submission' ? submissions : tasks;
  const report: BackfillReport = { assigned: 0, collisions: 0, entity, scanned: 0 };

  for (;;) {
    const pending = await db
      .select({ id: table.id })
      .from(table)
      .where(isNull(table.referenceCode))
      .limit(BATCH_SIZE);

    if (pending.length === 0) break;
    report.scanned += pending.length;

    for (const row of pending) {
      let assignedForRow = false;

      for (let attempt = 0; attempt < 5 && !assignedForRow; attempt += 1) {
        const candidate = mintReferenceCode(entity);
        // The WHERE clause is what makes a concurrent run safe: two backfills racing the same row
        // cannot both assign, because the second sees a non-null code and updates nothing. The
        // unique index catches the rarer race where two rows draw the same code.
        const updated = await db
          .update(table)
          .set({ referenceCode: candidate })
          .where(sql`${table.id} = ${row.id} AND ${table.referenceCode} IS NULL`)
          .returning({ id: table.id })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            if (!message.includes('reference_code_unique')) throw error;
            report.collisions += 1;
            return [];
          });

        if (updated.length > 0) {
          report.assigned += 1;
          assignedForRow = true;
        } else if (report.collisions === 0) {
          // No rows updated and no collision: another writer filled this row in first. Nothing to
          // do, and not an error.
          assignedForRow = true;
        }
      }
    }

    logger.info(
      `Reference code backfill (${entity}): ${report.assigned} assigned of ${report.scanned} scanned`
    );
  }

  return report;
}

export async function runReferenceCodeBackfill(): Promise<BackfillReport[]> {
  const reports: BackfillReport[] = [];
  for (const entity of ['task', 'submission'] as const) {
    reports.push(await backfillEntity(entity));
  }

  for (const report of reports) {
    logger.info(
      `Reference code backfill complete (${report.entity}): scanned ${report.scanned}, ` +
        `assigned ${report.assigned}, collisions retried ${report.collisions}`
    );
  }

  return reports;
}

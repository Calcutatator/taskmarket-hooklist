// Verifies: ADR-0003
//
// Every migration must be a safe no-op when re-applied. AGENTS.md states the rule, and
// `migrations-journal.test.ts` enforces everything about migrations that can be checked without a
// database -- sequential `idx`, strictly increasing `when`, file/entry parity. It cannot enforce
// this one, because the only honest way to know a statement is idempotent is to run it twice.
//
// The rule is not stylistic. The migrator gates solely on a timestamp comparison against the
// database's last-applied migration; it does not remember having run a particular file. So a
// `"when"` value retimed forward re-runs that migration against a database where it already
// applied, and an unguarded statement then throws -- which `server.ts` turns into `process.exit(1)`
// on every boot. One editing mistake becomes a crash loop, and this repository has already had a
// timestamp incident (`task_drop_id`).
//
// Seven migrations failed this check when it was written. Four were missing or insufficient guards
// -- including one that followed AGENTS.md's documented `duplicate_object` snippet exactly and
// still failed, because a UNIQUE constraint also creates an index and a repeat raises
// `duplicate_table`. The other three referenced columns a later migration legitimately dropped, so
// no guard on the statement could have saved them; they needed a guard on the column.
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getIntegrationDatabaseUrl } from '../helpers/integration-database';

const databaseUrl = getIntegrationDatabaseUrl();
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const migrationsDirectory = fileURLToPath(new URL('../../drizzle/migrations', import.meta.url));
// A throwaway *database*, not a schema. Several migrations qualify their targets as `public.x`,
// so a temporary schema on the shared database would send those statements to the real `public`
// -- rewriting the developer's own data. A separate database has no such escape hatch.
const probeDatabase = `migration_idempotency_${randomUUID().replaceAll('-', '')}`;

/**
 * Files in the order the migrator would apply them.
 *
 * Read from disk rather than from the journal on purpose: a `.sql` file with no journal entry is
 * invisible to the migrator and is exactly the mistake `migrations-journal.test.ts` exists to
 * catch. Reading the directory means a file that slipped past that check is still exercised here
 * rather than being skipped twice for the same reason.
 */
function migrationFiles(): string[] {
  return readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

function statementsIn(file: string): string[] {
  return readFileSync(`${migrationsDirectory}/${file}`, 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

describeWithDatabase('migrations are idempotent', () => {
  const admin = postgres(databaseUrl!, { max: 1 });
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    await admin.unsafe(`CREATE DATABASE "${probeDatabase}"`);
    const probeUrl = new URL(databaseUrl!);
    probeUrl.pathname = `/${probeDatabase}`;
    sql = postgres(probeUrl.toString(), { max: 1 });
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
    await admin.unsafe(`DROP DATABASE IF EXISTS "${probeDatabase}"`);
    await admin.end();
  });

  it('applies cleanly to an empty database', async () => {
    for (const file of migrationFiles()) {
      for (const statement of statementsIn(file)) {
        // Named in the assertion rather than left to the raw driver error, because a bare
        // "column already exists" gives no clue which of forty-odd files produced it.
        await expect(sql.unsafe(statement), `${file} failed on a fresh database`).resolves.toBeDefined();
      }
    }
  }, 180_000);

  it('re-applies every migration against the final schema without error', async () => {
    // Deliberately every file against the *final* schema, not each against the schema of its own
    // moment. That is the state a retimed `"when"` would actually re-run against, and it is the
    // stricter reading: a migration that reads a column a later migration drops has to guard on
    // the column, not merely on its own statement succeeding.
    for (const file of migrationFiles()) {
      for (const statement of statementsIn(file)) {
        await expect(
          sql.unsafe(statement),
          `${file} is not idempotent -- re-applying it threw. Guard the statement (IF NOT EXISTS / ` +
            `IF EXISTS, or a DO $$ ... EXCEPTION block catching duplicate_object OR duplicate_table), ` +
            `or if it reads schema a later migration removed, guard on that object existing.`
        ).resolves.toBeDefined();
      }
    }
  }, 180_000);
});

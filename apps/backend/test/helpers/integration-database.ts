import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { z } from 'zod';
import { getOptionalDatabaseUrl } from '../../src/config/env';
import * as schema from '../../src/db/schema';

const databaseNamePrefixSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, 'Database name prefix contains unsupported characters')
  .max(32);

export function getIntegrationDatabaseUrl(): string | undefined {
  return getOptionalDatabaseUrl();
}

export function createIsolatedMigratedDatabase(
  databaseNamePrefix: string,
  options: { maxConnections?: number } = {}
) {
  const validatedPrefix = databaseNamePrefixSchema.parse(databaseNamePrefix);
  const databaseUrl = getIntegrationDatabaseUrl();
  const databaseName = `${validatedPrefix}_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const isolatedDatabaseUrl = new URL(
    databaseUrl ?? 'postgresql://localhost:5432/integration_tests_unavailable'
  );
  isolatedDatabaseUrl.pathname = `/${databaseName}`;

  const adminClient = postgres(databaseUrl ?? isolatedDatabaseUrl.toString(), { max: 1 });
  const queryClient = postgres(isolatedDatabaseUrl.toString(), {
    max: options.maxConnections ?? 1,
  });
  const database = drizzle(queryClient, { schema });
  const migrationsFolder = fileURLToPath(new URL('../../drizzle/migrations', import.meta.url));
  let databaseCreated = false;
  let stopped = false;

  async function stop(): Promise<void> {
    if (stopped) {
      return;
    }
    stopped = true;

    await queryClient.end();
    if (databaseCreated) {
      await adminClient.unsafe(`DROP DATABASE "${databaseName}"`);
      databaseCreated = false;
    }
    await adminClient.end();
  }

  async function start(): Promise<void> {
    if (!databaseUrl) {
      return;
    }

    try {
      await adminClient.unsafe(`CREATE DATABASE "${databaseName}"`);
      databaseCreated = true;
      await migrate(database, { migrationsFolder });
    } catch (error) {
      await stop();
      throw error;
    }
  }

  return {
    database,
    isAvailable: databaseUrl !== undefined,
    start,
    stop,
    /**
     * The isolated database's own connection string.
     *
     * Exposed for tests that cannot simply be handed the `database` object above:
     * `src/db/client.ts` builds its singleton from `process.env.DATABASE_URL` at import time,
     * so anything exercising a module that imports it -- the x402 middleware, notably -- has to
     * point that variable at this database and import the module afterwards.
     */
    url: isolatedDatabaseUrl.toString(),
  };
}

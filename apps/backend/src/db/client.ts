import { drizzle } from 'drizzle-orm/postgres-js';
import postgresLib from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL!;

const queryClient = postgresLib(connectionString);
export const db = drizzle(queryClient, { schema });

export const migrationClient = postgresLib(connectionString, { max: 1 });

/**
 * Release the connection pool.
 *
 * For tests that point this module at a throwaway database and then have to drop it: Postgres
 * refuses to drop a database anything is still connected to, and this pool is opened at import
 * time by whatever module pulled `db` in. Nothing in the server calls it.
 */
export async function closeDatabase(): Promise<void> {
  await queryClient.end();
}

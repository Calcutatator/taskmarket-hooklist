import { drizzle } from 'drizzle-orm/postgres-js';
import postgresLib from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL!;

const queryClient = postgresLib(connectionString);
export const db = drizzle(queryClient, { schema });

export const migrationClient = postgresLib(connectionString, { max: 1 });

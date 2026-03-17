import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { app } from './app';
import { logger } from './lib/logger';
import { getServerConfig } from './config/env';
import { startIndexer } from './services/indexer';
import { startSmtpServer } from './services/smtp';
import { migrationClient, db } from './db/client';

const __dirname = dirname(fileURLToPath(import.meta.url));

const config = getServerConfig();
const PORT = config.PORT;

const migrationDb = drizzle(migrationClient);
const migrationsFolder = join(__dirname, '../drizzle/migrations');

logger.info('Running database migrations...');
migrate(migrationDb, { migrationsFolder })
  .then(() => migrationClient.end())
  .then(() => {
    logger.info('Migrations complete');
    app.listen(PORT, async () => {
      logger.info(`API server running on http://localhost:${PORT}`);
      logger.info(`tRPC endpoint: http://localhost:${PORT}/trpc`);
      logger.info(`Environment: ${config.NODE_ENV}`);

      await startIndexer();
      startSmtpServer(db);
    });
  })
  .catch((err) => {
    logger.error('Migration failed', err);
    process.exit(1);
  });

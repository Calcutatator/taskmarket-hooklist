import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { app } from './app';
import { logger } from './lib/logger';
import { getServerConfig } from './config/env';
import { catchUpIndexer, startIndexerPolling } from './services/indexer';
import { startSmtpServer } from './services/smtp';
import { migrationClient, db } from './db/client';
import { runConfiguredTaskAwardsBackfill } from './services/configured-task-awards-backfill';
import { prepareBackendState } from './services/startup-preparation';

const __dirname = dirname(fileURLToPath(import.meta.url));

const config = getServerConfig();
const PORT = config.PORT;

const migrationDb = drizzle(migrationClient);
const migrationsFolder = join(__dirname, '../drizzle/migrations');

async function startServer(): Promise<void> {
  await prepareBackendState({
    migrate: async () => {
      logger.info('Running database migrations...');
      await migrate(migrationDb, { migrationsFolder });
      await migrationClient.end();
      logger.info('Migrations complete');
    },
    catchUpIndexer: async () => {
      logger.info('Catching up event indexers...');
      await catchUpIndexer();
      logger.info('Event indexers caught up');
    },
    reconcileTaskAwards: async () => {
      logger.info('Running resumable task award backfill...');
      await runConfiguredTaskAwardsBackfill();
      logger.info('Task award backfill complete');
    },
  });

  app.listen(PORT, () => {
    logger.info(`API server running on http://localhost:${PORT}`);
    logger.info(`tRPC endpoint: http://localhost:${PORT}/trpc`);
    logger.info(`Environment: ${config.NODE_ENV}`);

    startIndexerPolling();
    startSmtpServer(db);
  });
}

startServer().catch((err) => {
  logger.error('Backend startup failed', err);
  process.exit(1);
});

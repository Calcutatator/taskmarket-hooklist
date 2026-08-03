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
import { startServerWalletReconciler } from './lib/wallet';
import { registerRelayedIntentHandlers } from './services/intents/register';
import {
  createRelayedIntentWorker,
  startRelayedIntentWorker,
} from './services/relayed-intent-worker';
import { setRuntimeRpcTelemetrySink } from './lib/rpc-gateway';
import { startRpcTelemetrySummary } from './lib/rpc-telemetry-aggregator';

const __dirname = dirname(fileURLToPath(import.meta.url));

const config = getServerConfig();
const PORT = config.PORT;

const migrationDb = drizzle(migrationClient);
const migrationsFolder = join(__dirname, '../drizzle/migrations');

// One periodic summary rather than a line per provider request. Production runs at log level
// `http`, so the per-request sink this replaces wrote a structured line for every attempt --
// tens of thousands per replica per day from the indexer alone, at zero user traffic. The
// aggregate carries the same ADR-0039 accounting in bounded-cardinality buckets.
setRuntimeRpcTelemetrySink(startRpcTelemetrySummary(logger).sink);

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
    startServerWalletReconciler();
    // Follow-on intents (ADR-0046) are enqueued from inside a completion handler, long after
    // the request that started the chain has gone, so nothing else would ever broadcast them.
    registerRelayedIntentHandlers();
    startRelayedIntentWorker(createRelayedIntentWorker());
    startSmtpServer(db);
  });
}

startServer().catch((err) => {
  logger.error('Backend startup failed', err);
  process.exit(1);
});

import { app } from './app';
import { logger } from './lib/logger';
import { getServerConfig } from './config/env';
import { startIndexer } from './services/indexer';

const config = getServerConfig();
const PORT = config.PORT;

app.listen(PORT, async () => {
  logger.info(`API server running on http://localhost:${PORT}`);
  logger.info(`tRPC endpoint: http://localhost:${PORT}/trpc`);
  logger.info(`Environment: ${config.NODE_ENV}`);

  await startIndexer();
});

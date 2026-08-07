import { createApp } from './app';
import { createCommandDispatcher } from './commands/dispatcher';
import { buildCommandManifest, commandNames } from './commands/manifest';
import { loadConfig } from './config';
import { writeOperationalEvent } from './observability/operational-events';
import { TaskmarketClient } from './services/taskmarket-client';

const config = loadConfig();
const app = createApp({
  commandDispatcher: createCommandDispatcher({
    allowedChannelIds: config.allowedChannelIds,
    allowedGuildIds: config.allowedGuildIds,
    docsUrl: config.docsUrl,
    statusUrl: config.statusUrl,
    supportUrl: config.supportUrl,
    taskmarket: new TaskmarketClient(config.taskmarketApiUrl),
    webUrl: config.webUrl,
  }),
  commitSha: config.commitSha,
  deployEnvironment: config.deployEnvironment,
  discordPublicKey: config.discordPublicKey,
  enabledCommands: commandNames(buildCommandManifest({ includeStatus: Boolean(config.statusUrl) })),
  recordOperationalEvent: writeOperationalEvent,
});

const server = app.listen(config.port, () => {
  process.stdout.write(`Discord app listening on port ${config.port}\n`);
});

function shutDown(): void {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutDown);
process.on('SIGTERM', shutDown);

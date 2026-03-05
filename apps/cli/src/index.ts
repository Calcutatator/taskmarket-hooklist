#!/usr/bin/env node
import { Command } from 'commander';
import { createRequire } from 'module';
import { initCommand } from './commands/init.js';
import { addressCommand } from './commands/address.js';
import { identityCommand } from './commands/identity.js';
import { statsCommand } from './commands/stats.js';
import { taskCommand } from './commands/task/index.js';
import { agentsCommand } from './commands/agents.js';
import { inboxCommand } from './commands/inbox.js';
import { depositCommand } from './commands/deposit.js';
import { walletCommand } from './commands/wallet/index.js';
import { withdrawCommand } from './commands/withdraw.js';
import { encryptCommand } from './commands/encrypt.js';
import { decryptCommand } from './commands/decrypt.js';
import { xmtpCommand } from './commands/xmtp.js';
import { daemonCommand } from './commands/daemon.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const program = new Command();

program.name('taskmarket').description('Taskmarket CLI for AI agents').version(version);

program.addCommand(initCommand);
program.addCommand(walletCommand);
program.addCommand(addressCommand);
program.addCommand(identityCommand);
program.addCommand(statsCommand);
program.addCommand(taskCommand);
program.addCommand(agentsCommand);
program.addCommand(inboxCommand);
program.addCommand(depositCommand);
program.addCommand(withdrawCommand);
program.addCommand(encryptCommand);
program.addCommand(decryptCommand);
program.addCommand(xmtpCommand);
program.addCommand(daemonCommand);

program.parseAsync(process.argv).catch((err: Error) => {
  process.stderr.write(JSON.stringify({ ok: false, error: err.message }) + '\n');
  process.exit(1);
});

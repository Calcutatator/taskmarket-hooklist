#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { addressCommand } from './commands/address.js';
import { identityCommand } from './commands/identity.js';
import { statsCommand } from './commands/stats.js';
import { taskCommand } from './commands/task/index.js';
import { agentsCommand } from './commands/agents.js';
import { inboxCommand } from './commands/inbox.js';
import { depositCommand } from './commands/deposit.js';
import { walletCommand } from './commands/wallet/index.js';

const program = new Command();

program.name('taskmarket').description('Taskmarket CLI for AI agents').version('0.3.1');

program.addCommand(initCommand);
program.addCommand(walletCommand);
program.addCommand(addressCommand);
program.addCommand(identityCommand);
program.addCommand(statsCommand);
program.addCommand(taskCommand);
program.addCommand(agentsCommand);
program.addCommand(inboxCommand);
program.addCommand(depositCommand);

program.parseAsync(process.argv).catch((err: Error) => {
  const human = process.argv.includes('--human') || process.env['TASKMARKET_FORMAT'] === 'human';
  if (!human) {
    console.error(JSON.stringify({ ok: false, error: err.message }));
  } else {
    console.error(err.message);
  }
  process.exit(1);
});

#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { addressCommand } from './commands/address.js';
import { identityCommand } from './commands/identity.js';
import { statsCommand } from './commands/stats.js';
import { taskCommand } from './commands/task/index.js';
import { agentsCommand } from './commands/agents.js';

const program = new Command();

program
  .name('taskmarket')
  .description('Taskmarket CLI for AI agents')
  .version('0.1.0');

program.addCommand(initCommand);
program.addCommand(addressCommand);
program.addCommand(identityCommand);
program.addCommand(statsCommand);
program.addCommand(taskCommand);
program.addCommand(agentsCommand);

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});

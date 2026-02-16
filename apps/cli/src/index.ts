#!/usr/bin/env node

import { Command } from 'commander';
import { createCommand } from './commands/create';
import { searchCommand } from './commands/search';
import { statsCommand } from './commands/stats';
import { submitCommand } from './commands/submit';
import { acceptCommand } from './commands/accept';
import { claimCommand } from './commands/claim';
import { proposeCommand } from './commands/propose';
import { rateCommand } from './commands/rate';

const program = new Command();

program.name('clawtasker').description('CLI for Clawtasker task marketplace').version('1.0.0');

program.addCommand(createCommand);
program.addCommand(searchCommand);
program.addCommand(statsCommand);
program.addCommand(submitCommand);
program.addCommand(acceptCommand);
program.addCommand(claimCommand);
program.addCommand(proposeCommand);
program.addCommand(rateCommand);

program.parse();

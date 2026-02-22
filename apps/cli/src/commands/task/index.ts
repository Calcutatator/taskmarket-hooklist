import { Command } from 'commander';
import { createCmd } from './create.js';
import { searchCmd } from './search.js';
import { getCmd } from './get.js';
import { submitCmd } from './submit.js';
import { acceptCmd } from './accept.js';
import { rateCmd } from './rate.js';
import { claimCmd } from './claim.js';
import { proposeCmd } from './propose.js';
import { proofCmd } from './proof.js';

export const taskCommand = new Command('task')
  .description('Manage tasks');

taskCommand.addCommand(createCmd);
taskCommand.addCommand(searchCmd);
taskCommand.addCommand(getCmd);
taskCommand.addCommand(submitCmd);
taskCommand.addCommand(acceptCmd);
taskCommand.addCommand(rateCmd);
taskCommand.addCommand(claimCmd);
taskCommand.addCommand(proposeCmd);
taskCommand.addCommand(proofCmd);

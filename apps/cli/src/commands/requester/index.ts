import { Command } from 'commander';
import { requesterStatsCmd } from './stats.js';

export const requesterCmd = new Command('requester')
  .description('Requester reputation commands')
  .addCommand(requesterStatsCmd);

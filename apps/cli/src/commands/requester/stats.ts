import { Command } from 'commander';
import { apiGet } from '../../lib/api.js';
import { printResult, printError } from '../../lib/output.js';

export const requesterStatsCmd = new Command('stats')
  .description('Get requester reputation stats for an address')
  .argument('<address>', 'Wallet address of the requester')
  .action(async (address: string) => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      printError('Address must be a 0x-prefixed 20-byte hex string');
      process.exit(1);
      return;
    }

    const data = await apiGet(`/api/requester/${address}/stats`);
    if (!data) {
      printError('No stats found for address');
      process.exit(1);
      return;
    }
    printResult(data);
  });

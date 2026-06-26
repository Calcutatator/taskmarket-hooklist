import { Command } from 'commander';
import { apiGet } from '../../lib/api.js';
import { loadKeystore } from '../../lib/keystore.js';
import { printResult, printError } from '../../lib/output.js';

export const mySubmissionsCmd = new Command('my-submissions')
  .description('List all submissions made by your wallet across all tasks.')
  .option('--address <address>', 'Wallet address to query (defaults to own wallet from keystore)')
  .action(async (opts: { address?: string }) => {
    try {
      let address = opts.address;
      if (!address) {
        const keystore = await loadKeystore();
        address = keystore.walletAddress;
      }
      const result = await apiGet(
        `/api/submissions/mine?workerAddress=${encodeURIComponent(address)}`
      );
      printResult(result as Record<string, unknown>);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

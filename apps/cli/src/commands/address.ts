import { Command } from 'commander';
import { loadKeystore } from '../lib/keystore.js';
import { isHumanMode, printResult } from '../lib/output.js';

export const addressCommand = new Command('address')
  .description('Print the wallet address')
  .option('--human', 'Human-readable output')
  .action(async (opts: { human?: boolean }) => {
    const human = isHumanMode(opts.human);
    const keystore = await loadKeystore();
    if (human) {
      console.log(keystore.walletAddress);
    } else {
      printResult({ address: keystore.walletAddress }, human);
    }
  });

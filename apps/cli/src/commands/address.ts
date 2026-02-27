import { Command } from 'commander';
import { loadKeystore } from '../lib/keystore.js';
import { printResult } from '../lib/output.js';

export const addressCommand = new Command('address')
  .description('Print the wallet address')
  .action(async () => {
    const keystore = await loadKeystore();
    printResult({ address: keystore.walletAddress });
  });

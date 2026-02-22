import { Command } from 'commander';
import { loadKeystore } from '../lib/keystore.js';

export const addressCommand = new Command('address')
  .description('Print the wallet address')
  .action(async () => {
    const keystore = await loadKeystore();
    console.log(keystore.walletAddress);
  });

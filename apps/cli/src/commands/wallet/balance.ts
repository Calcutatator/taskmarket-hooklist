import { Command } from 'commander';
import { loadKeystore } from '../../lib/keystore.js';
import { apiGet } from '../../lib/api.js';
import { printResult } from '../../lib/output.js';

export const walletBalanceCommand = new Command('balance')
  .description('Show USDC balance')
  .option('--address <addr>', 'Address to check (defaults to own wallet)')
  .action(async (opts: { address?: string }) => {
    let address = opts.address;
    if (!address) {
      const keystore = await loadKeystore();
      address = keystore.walletAddress;
    }

    const result = (await apiGet(`/api/wallet/balance?address=${address}`)) as {
      address: string;
      balanceBaseUnits: string;
      balanceUsdc: string;
    };

    printResult(result);
  });

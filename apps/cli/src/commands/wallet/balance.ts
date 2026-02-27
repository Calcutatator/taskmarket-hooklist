import { Command } from 'commander';
import { loadKeystore } from '../../lib/keystore.js';
import { apiGet } from '../../lib/api.js';
import { isHumanMode, printResult } from '../../lib/output.js';

export const walletBalanceCommand = new Command('balance')
  .description('Show USDC balance')
  .option('--address <addr>', 'Address to check (defaults to own wallet)')
  .option('--human', 'Human-readable output')
  .action(async (opts: { address?: string; human?: boolean }) => {
    const human = isHumanMode(opts.human);
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

    if (human) {
      console.log('Address:', result.address);
      console.log('Balance:', result.balanceUsdc, 'USDC');
    } else {
      printResult(result, human);
    }
  });

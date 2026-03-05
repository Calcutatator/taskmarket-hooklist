import { Command } from 'commander';
import { loadKeystore } from '../../lib/keystore.js';
import { apiGet } from '../../lib/api.js';
import { printResult } from '../../lib/output.js';

export const addressCommand = new Command('address')
  .description('Show your registered email address')
  .action(async () => {
    const keystore = await loadKeystore();
    const result = (await apiGet(`/api/agents/stats?address=${keystore.walletAddress}`)) as {
      emailAddress?: string | null;
    };
    printResult({ emailAddress: result.emailAddress ?? null });
  });

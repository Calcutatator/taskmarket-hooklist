import { Command } from 'commander';
import { loadKeystore } from '../lib/keystore.js';
import { apiGet } from '../lib/api.js';
import { x402Post } from '../lib/x402.js';
import { printResult } from '../lib/output.js';

export const identityCommand = new Command('identity').description('Manage agent identity');

identityCommand
  .command('register')
  .description('Register ERC-8004 agent identity (costs 0.001 USDC)')
  .action(async () => {
    const result = (await x402Post('/api/identity/register', {})) as {
      agentId: string;
      alreadyRegistered: boolean;
    };
    printResult({ agentId: result.agentId });
  });

identityCommand
  .command('status')
  .description('Check identity registration status')
  .action(async () => {
    const keystore = await loadKeystore();
    const result = (await apiGet(`/api/identity/status?address=${keystore.walletAddress}`)) as {
      agentId: string | null;
      registered: boolean;
    };
    printResult({ registered: result.registered, agentId: result.agentId });
  });

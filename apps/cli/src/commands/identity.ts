import { Command } from 'commander';
import { loadKeystore } from '../lib/keystore.js';
import { apiGet } from '../lib/api.js';
import { x402Post } from '../lib/x402.js';

export const identityCommand = new Command('identity')
  .description('Manage agent identity');

identityCommand
  .command('register')
  .description('Register ERC-8004 agent identity (costs 0.001 USDC)')
  .action(async () => {
    const result = (await x402Post('/api/identity/register', {})) as {
      agentId: string;
      alreadyRegistered: boolean;
    };
    if (result.alreadyRegistered) {
      console.log('Already registered. Agent ID:', result.agentId);
    } else {
      console.log('Agent ID:', result.agentId);
    }
  });

identityCommand
  .command('status')
  .description('Check identity registration status')
  .action(async () => {
    const keystore = await loadKeystore();
    const result = (await apiGet(
      `/api/identity/status?address=${keystore.walletAddress}`
    )) as {
      agentId: string | null;
      registered: boolean;
    };
    if (result.registered) {
      console.log('Registered. Agent ID:', result.agentId);
    } else {
      console.log('Not registered. Run: taskmarket identity register');
    }
  });

import { Command } from 'commander';
import { api } from '../lib/api';
import { getWallet, getAddress } from '../lib/wallet';
import { getCliConfig } from '../lib/config';
import { TaskMarketABI } from '@clawtasker/contracts/abi';
import { createWalletClient, http, parseUnits } from 'viem';
import { base } from 'viem/chains';

export const claimCommand = new Command('claim')
  .description('Claim an Instant mode task with stake')
  .argument('<taskId>', 'Task ID')
  .option('--stake <amount>', 'Stake amount in USDC (defaults to 10% of reward)')
  .action(async (taskId, options) => {
    try {
      const config = getCliConfig();
      const wallet = await getWallet();
      const address = await getAddress();

      const task = await api.tasks.get.query({ taskId });

      if (!task) {
        console.error('Task not found');
        process.exit(1);
      }

      if (task.mode !== 'instant') {
        console.error('This task is not in Instant mode');
        process.exit(1);
      }

      if (task.status !== 'open') {
        console.error('Task is not available for claiming');
        process.exit(1);
      }

      const stakeAmount = options.stake
        ? parseUnits(options.stake, 6)
        : (BigInt(task.reward) * BigInt(task.stakeBps)) / 10000n;

      console.log(`Claiming task ${taskId}...`);
      console.log(`Stake: ${(Number(stakeAmount) / 1e6).toFixed(2)} USDC`);

      const walletClient = createWalletClient({
        account: wallet.getDefaultAddress() as any,
        chain: base,
        transport: http(config.BASE_RPC_URL),
      });

      console.log('\nStep 1/2: Approving stake USDC...');
      const approveTx = await walletClient.writeContract({
        address: config.USDC_ADDRESS as `0x${string}`,
        abi: [
          {
            name: 'approve',
            type: 'function',
            stateMutability: 'nonpayable',
            inputs: [
              { name: 'spender', type: 'address' },
              { name: 'amount', type: 'uint256' },
            ],
            outputs: [{ type: 'bool' }],
          },
        ],
        functionName: 'approve',
        args: [config.TASK_MARKET_ADDRESS, stakeAmount],
      });

      console.log(`Approval tx: ${approveTx}`);

      console.log('\nStep 2/2: Claiming task on-chain...');
      const claimTx = await walletClient.writeContract({
        address: config.TASK_MARKET_ADDRESS as `0x${string}`,
        abi: TaskMarketABI,
        functionName: 'claimTask',
        args: [taskId as `0x${string}`, stakeAmount],
      });

      console.log(`Claim tx: ${claimTx}`);

      console.log('\nRegistering claim with backend...');
      await api.claims.claim.mutate({
        taskId,
        workerAddress: address,
        stakeTxHash: claimTx,
        signature: await wallet.signMessage(`Claim task ${taskId}`),
      });

      console.log('\n✓ Task claimed successfully!');
      console.log('You now have exclusive rights to submit work for this task.');
      console.log('Your stake will be returned when the requester accepts your work.');
    } catch (error) {
      console.error('Error claiming task:', error);
      process.exit(1);
    }
  });

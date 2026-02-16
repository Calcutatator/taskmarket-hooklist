import { Command } from 'commander';
import { api } from '../lib/api';
import { getWallet } from '../lib/wallet';
import { getCliConfig } from '../lib/config';
import { TaskMarketABI } from '@clawtasker/contracts/abi';
import { createWalletClient, http, parseUnits } from 'viem';
import { base } from 'viem/chains';

export const acceptCommand = new Command('accept')
  .description('Accept a submission and release payment')
  .argument('<taskId>', 'Task ID')
  .requiredOption('-w, --worker <address>', 'Worker address to pay')
  .option('-s, --submission <id>', 'Submission ID (for downloading work)')
  .action(async (taskId, options) => {
    try {
      const config = getCliConfig();
      const wallet = await getWallet();

      const task = await api.tasks.get.query({ taskId });

      if (!task) {
        console.error('Task not found');
        process.exit(1);
      }

      console.log(`Accepting submission for task ${taskId}...`);
      console.log(`Worker: ${options.worker}`);
      console.log(`Reward: ${(Number(task.reward) / 1e6).toFixed(2)} USDC`);

      const walletClient = createWalletClient({
        account: wallet.getDefaultAddress() as any,
        chain: base,
        transport: http(config.BASE_RPC_URL),
      });

      const acceptTx = await walletClient.writeContract({
        address: config.TASK_MARKET_ADDRESS as `0x${string}`,
        abi: TaskMarketABI,
        functionName: 'acceptSubmission',
        args: [taskId as `0x${string}`, options.worker as `0x${string}`],
      });

      console.log(`Accept tx: ${acceptTx}`);

      const fee = (Number(task.reward) * task.platformFeeBps) / 10000;
      const workerPayment = Number(task.reward) - fee;

      console.log('\nUpdating backend...');
      await api.acceptance.accept.mutate({
        taskId,
        worker: options.worker,
        txHash: acceptTx,
        workerPayment: workerPayment.toString(),
        platformFee: fee.toString(),
      });

      console.log('\n✓ Submission accepted!');
      console.log(`Worker payment: ${(workerPayment / 1e6).toFixed(2)} USDC`);
      console.log(`Platform fee: ${(fee / 1e6).toFixed(2)} USDC`);
    } catch (error) {
      console.error('Error accepting submission:', error);
      process.exit(1);
    }
  });

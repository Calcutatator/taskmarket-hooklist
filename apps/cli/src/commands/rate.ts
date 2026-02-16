import { Command } from 'commander';
import { api } from '../lib/api';
import { getWallet } from '../lib/wallet';
import { getCliConfig } from '../lib/config';
import { TaskMarketABI } from '@clawtasker/contracts/abi';
import { createWalletClient, createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

export const rateCommand = new Command('rate')
  .description('Rate a completed task')
  .argument('<taskId>', 'Task ID')
  .requiredOption('-s, --stars <rating>', 'Rating (1-5 stars)')
  .action(async (taskId, options) => {
    try {
      const config = getCliConfig();
      const wallet = await getWallet();

      const rating = parseInt(options.stars);

      if (rating < 1 || rating > 5) {
        console.error('Rating must be between 1 and 5 stars');
        process.exit(1);
      }

      const task = await api.tasks.get.query({ taskId });

      if (!task) {
        console.error('Task not found');
        process.exit(1);
      }

      if (task.status !== 'accepted') {
        console.error('Task must be accepted before rating');
        process.exit(1);
      }

      if (task.rating) {
        console.error('Task has already been rated');
        process.exit(1);
      }

      if (!task.worker) {
        console.error('No worker assigned to this task');
        process.exit(1);
      }

      console.log(`Rating task ${taskId}...`);
      console.log(`Worker: ${task.worker}`);
      console.log(`Rating: ${rating} stars`);

      const walletClient = createWalletClient({
        account: wallet.getDefaultAddress() as any,
        chain: base,
        transport: http(config.BASE_RPC_URL),
      });

      const rateTx = await walletClient.writeContract({
        address: config.TASK_MARKET_ADDRESS as `0x${string}`,
        abi: TaskMarketABI,
        functionName: 'rateTask',
        args: [taskId as `0x${string}`, rating],
      });

      console.log(`Rate tx: ${rateTx}`);

      const publicClient = createPublicClient({
        chain: base,
        transport: http(config.BASE_RPC_URL),
      });

      console.log('\nWaiting for transaction receipt...');
      const receipt = await publicClient.waitForTransactionReceipt({ hash: rateTx });

      console.log('\nUpdating backend...');
      await api.acceptance.rate.mutate({
        taskId,
        worker: task.worker,
        rating,
        txHash: rateTx,
        blockNumber: Number(receipt.blockNumber),
      });

      console.log('\n✓ Task rated successfully!');
    } catch (error) {
      console.error('Error rating task:', error);
      process.exit(1);
    }
  });

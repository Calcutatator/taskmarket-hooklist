import { Command } from 'commander';
import { api } from '../lib/api';
import { getWallet, getAddress } from '../lib/wallet';
import { getCliConfig } from '../lib/config';
import { TaskMarketABI } from '@clawtasker/contracts/abi';
import { createPublicClient, createWalletClient, http, parseUnits } from 'viem';
import { base } from 'viem/chains';
import { randomBytes } from 'crypto';

export const createCommand = new Command('create')
  .description('Create a new task')
  .requiredOption('-d, --description <text>', 'Task description')
  .requiredOption('-r, --reward <amount>', 'Reward amount in USDC')
  .requiredOption('--duration <hours>', 'Task duration in hours')
  .option('-m, --mode <mode>', 'Task mode (contest|instant|proposal|race)', 'contest')
  .option('-t, --tags <tags>', 'Comma-separated tags', '')
  .option('--stake-required', 'Require stake for Instant mode', false)
  .option('--stake-bps <bps>', 'Stake percentage in basis points', '1000')
  .option('--proposal-deadline <hours>', 'Proposal deadline in hours (Proposal mode)')
  .option('--metric <description>', 'Metric description (Race mode)')
  .option('--metric-target <target>', 'Metric target value (Race mode)')
  .action(async (options) => {
    try {
      const config = getCliConfig();
      const wallet = await getWallet();
      const address = await getAddress();

      const rewardUSDC = parseUnits(options.reward, 6);
      const durationSeconds = parseInt(options.duration) * 3600;
      const taskId = '0x' + randomBytes(32).toString('hex');

      console.log(`Creating ${options.mode} task...`);
      console.log(`Task ID: ${taskId}`);
      console.log(`Reward: ${options.reward} USDC`);
      console.log(`Duration: ${options.duration} hours`);

      const walletClient = createWalletClient({
        account: wallet.getDefaultAddress() as any,
        chain: base,
        transport: http(config.BASE_RPC_URL),
      });

      console.log('\nStep 1/2: Approving USDC...');
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
        args: [config.TASK_MARKET_ADDRESS, rewardUSDC],
      });

      console.log(`Approval tx: ${approveTx}`);

      console.log('\nStep 2/2: Creating task on-chain...');
      const proposalDeadline =
        options.mode === 'proposal' && options.proposalDeadline
          ? parseInt(options.proposalDeadline) * 3600
          : 0;

      const createTx = await walletClient.writeContract({
        address: config.TASK_MARKET_ADDRESS as `0x${string}`,
        abi: TaskMarketABI,
        functionName: 'createTask',
        args: [taskId as `0x${string}`, rewardUSDC, BigInt(durationSeconds), 0, BigInt(proposalDeadline)],
      });

      console.log(`Create tx: ${createTx}`);

      console.log('\nRegistering task with backend...');
      const tags = options.tags ? options.tags.split(',').map((t: string) => t.trim()) : [];

      await api.tasks.create.mutate({
        id: taskId,
        requester: address,
        requesterPubkey: address,
        description: options.description,
        reward: rewardUSDC.toString(),
        escrowTxHash: createTx,
        expiryTime: new Date(Date.now() + durationSeconds * 1000).toISOString(),
        tags,
        mode: options.mode,
        stakeRequired: options.stakeRequired,
        stakeBps: parseInt(options.stakeBps),
        metricDescription: options.metric,
        metricTarget: options.metricTarget,
        proposalDeadline: proposalDeadline
          ? new Date(Date.now() + proposalDeadline * 1000).toISOString()
          : undefined,
      });

      console.log('\n✓ Task created successfully!');
      console.log(`View at: ${config.API_URL}/tasks/${taskId}`);
    } catch (error) {
      console.error('Error creating task:', error);
      process.exit(1);
    }
  });

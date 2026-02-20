import { createPublicClient, http, parseAbi } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { createServerWallet } from '../lib/wallet';
import { getServerConfig } from '../config/env';

const ERC20_ABI = parseAbi(['function approve(address,uint256) returns (bool)']);
const MARKET_ABI = parseAbi([
  'function createTask(bytes32,address,uint256,uint256,uint8,uint256)',
  'function claimTask(bytes32,address,uint256)',
  'function selectWorker(bytes32,address,address)',
  'function acceptSubmission(bytes32,address,address)',
  'function rateTask(bytes32,address,uint8)',
]);

export const MODE_MAP: Record<string, number> = {
  contest: 0,
  instant: 1,
  proposal: 2,
  race: 3,
};

function getPublicClient() {
  const config = getServerConfig();
  const chain = config.CHAIN_ID === 84532 ? baseSepolia : base;
  return createPublicClient({ chain, transport: http(config.BASE_RPC_URL) });
}

function assertSuccess(receipt: { status: string }, label: string) {
  if (receipt.status !== 'success') {
    throw new Error(`Contract tx reverted: ${label}`);
  }
}

export async function contractCreateTask(
  taskId: `0x${string}`,
  requester: `0x${string}`,
  reward: bigint,
  durationSecs: bigint,
  mode: number,
  proposalDeadlineSecs: bigint = 0n
): Promise<`0x${string}`> {
  const config = getServerConfig();
  const { client } = createServerWallet();
  const publicClient = getPublicClient();

  const approveTx = await client.writeContract({
    address: config.USDC_TOKEN_ADDRESS as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [config.CONTRACT_ADDRESS as `0x${string}`, reward],
  });
  assertSuccess(await publicClient.waitForTransactionReceipt({ hash: approveTx }), 'approve');

  const createTx = await client.writeContract({
    address: config.CONTRACT_ADDRESS as `0x${string}`,
    abi: MARKET_ABI,
    functionName: 'createTask',
    args: [taskId, requester, reward, durationSecs, mode, proposalDeadlineSecs],
  });
  assertSuccess(await publicClient.waitForTransactionReceipt({ hash: createTx }), 'createTask');
  return createTx;
}

export async function contractClaimTask(
  taskId: `0x${string}`,
  worker: `0x${string}`,
  stakeAmount: bigint
): Promise<`0x${string}`> {
  const config = getServerConfig();
  const { client } = createServerWallet();
  const publicClient = getPublicClient();

  const hash = await client.writeContract({
    address: config.CONTRACT_ADDRESS as `0x${string}`,
    abi: MARKET_ABI,
    functionName: 'claimTask',
    args: [taskId, worker, stakeAmount],
  });
  assertSuccess(await publicClient.waitForTransactionReceipt({ hash }), 'claimTask');
  return hash;
}

export async function contractSelectWorker(
  taskId: `0x${string}`,
  requester: `0x${string}`,
  worker: `0x${string}`
): Promise<`0x${string}`> {
  const config = getServerConfig();
  const { client } = createServerWallet();
  const publicClient = getPublicClient();

  const hash = await client.writeContract({
    address: config.CONTRACT_ADDRESS as `0x${string}`,
    abi: MARKET_ABI,
    functionName: 'selectWorker',
    args: [taskId, requester, worker],
  });
  assertSuccess(await publicClient.waitForTransactionReceipt({ hash }), 'selectWorker');
  return hash;
}

export async function contractAcceptSubmission(
  taskId: `0x${string}`,
  requester: `0x${string}`,
  worker: `0x${string}`
): Promise<`0x${string}`> {
  const config = getServerConfig();
  const { client } = createServerWallet();
  const hash = await client.writeContract({
    address: config.CONTRACT_ADDRESS as `0x${string}`,
    abi: MARKET_ABI,
    functionName: 'acceptSubmission',
    args: [taskId, requester, worker],
  });
  assertSuccess(await getPublicClient().waitForTransactionReceipt({ hash }), 'acceptSubmission');
  return hash;
}

export async function contractRateTask(
  taskId: `0x${string}`,
  requester: `0x${string}`,
  rating: number
): Promise<{ hash: `0x${string}`; blockNumber: number }> {
  const config = getServerConfig();
  const { client } = createServerWallet();
  const hash = await client.writeContract({
    address: config.CONTRACT_ADDRESS as `0x${string}`,
    abi: MARKET_ABI,
    functionName: 'rateTask',
    args: [taskId, requester, rating],
  });
  const receipt = await getPublicClient().waitForTransactionReceipt({ hash });
  return { hash, blockNumber: Number(receipt.blockNumber) };
}

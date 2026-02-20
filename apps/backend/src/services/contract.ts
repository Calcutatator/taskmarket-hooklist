import { createPublicClient, http, parseAbi } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { createServerWallet } from '../lib/wallet';
import { getServerConfig } from '../config/env';

const ERC20_ABI = parseAbi(['function approve(address,uint256) returns (bool)']);
const MARKET_ABI = parseAbi([
  'function createTask(bytes32,uint256,uint256,uint8,uint256)',
  'function acceptSubmission(bytes32,address)',
  'function rateTask(bytes32,uint8)',
]);

export const MODE_MAP: Record<string, number> = {
  contest: 0, instant: 1, proposal: 2, race: 3,
};

function getPublicClient() {
  const config = getServerConfig();
  const chain = config.CHAIN_ID === 84532 ? baseSepolia : base;
  return createPublicClient({ chain, transport: http(config.BASE_RPC_URL) });
}

export async function contractCreateTask(
  taskId: `0x${string}`,
  reward: bigint,
  durationSecs: bigint,
  mode: number,
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
  await publicClient.waitForTransactionReceipt({ hash: approveTx });

  const createTx = await client.writeContract({
    address: config.CONTRACT_ADDRESS as `0x${string}`,
    abi: MARKET_ABI,
    functionName: 'createTask',
    args: [taskId, reward, durationSecs, mode, 0n],
  });
  await publicClient.waitForTransactionReceipt({ hash: createTx });
  return createTx;
}

export async function contractAcceptSubmission(
  taskId: `0x${string}`,
  worker: `0x${string}`,
): Promise<`0x${string}`> {
  const config = getServerConfig();
  const { client } = createServerWallet();
  const hash = await client.writeContract({
    address: config.CONTRACT_ADDRESS as `0x${string}`,
    abi: MARKET_ABI,
    functionName: 'acceptSubmission',
    args: [taskId, worker],
  });
  await getPublicClient().waitForTransactionReceipt({ hash });
  return hash;
}

export async function contractRateTask(
  taskId: `0x${string}`,
  rating: number,
): Promise<{ hash: `0x${string}`; blockNumber: number }> {
  const config = getServerConfig();
  const { client } = createServerWallet();
  const hash = await client.writeContract({
    address: config.CONTRACT_ADDRESS as `0x${string}`,
    abi: MARKET_ABI,
    functionName: 'rateTask',
    args: [taskId, rating],
  });
  const receipt = await getPublicClient().waitForTransactionReceipt({ hash });
  return { hash, blockNumber: Number(receipt.blockNumber) };
}

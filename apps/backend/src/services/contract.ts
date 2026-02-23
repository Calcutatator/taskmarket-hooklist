import { createPublicClient, http, parseAbi, parseAbiItem, decodeEventLog } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { createServerWallet } from '../lib/wallet';
import { getServerConfig } from '../config/env';

const ERC20_ABI = parseAbi([
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
]);
const MARKET_ABI = parseAbi([
  'function createTask(bytes32,address,uint256,uint256,uint8,uint256,uint256)',
  'function claimTask(bytes32,address,uint256)',
  'function selectWorker(bytes32,address,address)',
  'function acceptSubmission(bytes32,address,address)',
  'function rateTask(bytes32,address,uint8,uint256,string,bytes32)',
  'function submitBid(bytes32,address,uint256)',
  'function selectLowestBidder(bytes32)',
]);
const IDENTITY_REGISTRY_ABI = parseAbi(['function register() external returns (uint256)']);
const REGISTERED_EVENT = parseAbiItem(
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)'
);

export const MODE_MAP: Record<string, number> = {
  bounty: 0,
  claim: 1,
  pitch: 2,
  benchmark: 3,
  auction: 4,
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
  pitchDeadlineSecs: bigint = 0n,
  bidDeadlineSecs: bigint = 0n,
  paymentTxHash?: `0x${string}`
): Promise<`0x${string}`> {
  const config = getServerConfig();
  const { client } = createServerWallet();
  const publicClient = getPublicClient();

  if (paymentTxHash) {
    await publicClient.waitForTransactionReceipt({ hash: paymentTxHash });
  }

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
    args: [taskId, requester, reward, durationSecs, mode, pitchDeadlineSecs, bidDeadlineSecs],
  });
  assertSuccess(await publicClient.waitForTransactionReceipt({ hash: createTx }), 'createTask');
  return createTx;
}

export async function contractSubmitBid(
  taskId: `0x${string}`,
  worker: `0x${string}`,
  price: bigint
): Promise<`0x${string}`> {
  const config = getServerConfig();
  const { client } = createServerWallet();
  const hash = await client.writeContract({
    address: config.CONTRACT_ADDRESS as `0x${string}`,
    abi: MARKET_ABI,
    functionName: 'submitBid',
    args: [taskId, worker, price],
  });
  assertSuccess(await getPublicClient().waitForTransactionReceipt({ hash }), 'submitBid');
  return hash;
}

export async function contractSelectLowestBidder(taskId: `0x${string}`): Promise<`0x${string}`> {
  const config = getServerConfig();
  const { client } = createServerWallet();
  const hash = await client.writeContract({
    address: config.CONTRACT_ADDRESS as `0x${string}`,
    abi: MARKET_ABI,
    functionName: 'selectLowestBidder',
    args: [taskId],
  });
  assertSuccess(await getPublicClient().waitForTransactionReceipt({ hash }), 'selectLowestBidder');
  return hash;
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
  rating: number,
  workerAgentId: bigint,
  feedbackURI: string,
  feedbackHash: `0x${string}`
): Promise<{ hash: `0x${string}`; blockNumber: number }> {
  const config = getServerConfig();
  const { client } = createServerWallet();
  const hash = await client.writeContract({
    address: config.CONTRACT_ADDRESS as `0x${string}`,
    abi: MARKET_ABI,
    functionName: 'rateTask',
    args: [taskId, requester, rating, workerAgentId, feedbackURI, feedbackHash],
  });
  const receipt = await getPublicClient().waitForTransactionReceipt({ hash });
  assertSuccess(receipt, 'rateTask');
  return { hash, blockNumber: Number(receipt.blockNumber) };
}

export async function contractRegisterIdentity(): Promise<bigint> {
  const config = getServerConfig();
  const { client } = createServerWallet();
  const publicClient = getPublicClient();

  const hash = await client.writeContract({
    address: config.ERC8004_IDENTITY_REGISTRY as `0x${string}`,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'register',
    args: [],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assertSuccess(receipt, 'registerIdentity');

  // Parse agentId from Registered(uint256 indexed agentId, ...) event
  const registryAddress = (config.ERC8004_IDENTITY_REGISTRY as string).toLowerCase();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== registryAddress) continue;
    try {
      const decoded = decodeEventLog({
        abi: [REGISTERED_EVENT],
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === 'Registered') {
        return (decoded.args as { agentId: bigint }).agentId;
      }
    } catch {
      // not this event
    }
  }

  throw new Error('Registered event not found in registerIdentity receipt');
}

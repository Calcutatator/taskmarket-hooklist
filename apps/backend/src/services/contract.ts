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

const TX_RECEIPT_TIMEOUT = 60_000; // 1 minute
const GAS_MULTIPLIER = 2n;

function getPublicClient() {
  const config = getServerConfig();
  const chain = config.CHAIN_ID === 84532 ? baseSepolia : base;
  return createPublicClient({ chain, transport: http(config.BASE_RPC_URL) });
}

async function getGasParams(publicClient: ReturnType<typeof getPublicClient>) {
  const fees = await publicClient.estimateFeesPerGas();
  return {
    maxFeePerGas: fees.maxFeePerGas * GAS_MULTIPLIER,
    maxPriorityFeePerGas: (fees.maxPriorityFeePerGas ?? 1_000_000n) * GAS_MULTIPLIER,
  };
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
    await publicClient.waitForTransactionReceipt({
      hash: paymentTxHash,
      timeout: TX_RECEIPT_TIMEOUT,
    });
  }

  const gas = await getGasParams(publicClient);

  const approveTx = await client.writeContract({
    address: config.USDC_TOKEN_ADDRESS as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [config.CONTRACT_ADDRESS as `0x${string}`, reward],
    ...gas,
  });
  assertSuccess(
    await publicClient.waitForTransactionReceipt({ hash: approveTx, timeout: TX_RECEIPT_TIMEOUT }),
    'approve'
  );

  const createTx = await client.writeContract({
    address: config.CONTRACT_ADDRESS as `0x${string}`,
    abi: MARKET_ABI,
    functionName: 'createTask',
    args: [taskId, requester, reward, durationSecs, mode, pitchDeadlineSecs, bidDeadlineSecs],
    ...gas,
  });
  assertSuccess(
    await publicClient.waitForTransactionReceipt({ hash: createTx, timeout: TX_RECEIPT_TIMEOUT }),
    'createTask'
  );
  return createTx;
}

export async function contractSubmitBid(
  taskId: `0x${string}`,
  worker: `0x${string}`,
  price: bigint
): Promise<`0x${string}`> {
  const config = getServerConfig();
  const { client } = createServerWallet();
  const publicClient = getPublicClient();
  const gas = await getGasParams(publicClient);
  const hash = await client.writeContract({
    address: config.CONTRACT_ADDRESS as `0x${string}`,
    abi: MARKET_ABI,
    functionName: 'submitBid',
    args: [taskId, worker, price],
    ...gas,
  });
  assertSuccess(
    await publicClient.waitForTransactionReceipt({ hash, timeout: TX_RECEIPT_TIMEOUT }),
    'submitBid'
  );
  return hash;
}

export async function contractSelectLowestBidder(taskId: `0x${string}`): Promise<`0x${string}`> {
  const config = getServerConfig();
  const { client } = createServerWallet();
  const publicClient = getPublicClient();
  const gas = await getGasParams(publicClient);
  const hash = await client.writeContract({
    address: config.CONTRACT_ADDRESS as `0x${string}`,
    abi: MARKET_ABI,
    functionName: 'selectLowestBidder',
    args: [taskId],
    ...gas,
  });
  assertSuccess(
    await publicClient.waitForTransactionReceipt({ hash, timeout: TX_RECEIPT_TIMEOUT }),
    'selectLowestBidder'
  );
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
  const gas = await getGasParams(publicClient);
  const hash = await client.writeContract({
    address: config.CONTRACT_ADDRESS as `0x${string}`,
    abi: MARKET_ABI,
    functionName: 'claimTask',
    args: [taskId, worker, stakeAmount],
    ...gas,
  });
  assertSuccess(
    await publicClient.waitForTransactionReceipt({ hash, timeout: TX_RECEIPT_TIMEOUT }),
    'claimTask'
  );
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
  const gas = await getGasParams(publicClient);
  const hash = await client.writeContract({
    address: config.CONTRACT_ADDRESS as `0x${string}`,
    abi: MARKET_ABI,
    functionName: 'selectWorker',
    args: [taskId, requester, worker],
    ...gas,
  });
  assertSuccess(
    await publicClient.waitForTransactionReceipt({ hash, timeout: TX_RECEIPT_TIMEOUT }),
    'selectWorker'
  );
  return hash;
}

export async function contractAcceptSubmission(
  taskId: `0x${string}`,
  requester: `0x${string}`,
  worker: `0x${string}`
): Promise<`0x${string}`> {
  const config = getServerConfig();
  const { client } = createServerWallet();
  const publicClient = getPublicClient();
  const gas = await getGasParams(publicClient);
  const hash = await client.writeContract({
    address: config.CONTRACT_ADDRESS as `0x${string}`,
    abi: MARKET_ABI,
    functionName: 'acceptSubmission',
    args: [taskId, requester, worker],
    ...gas,
  });
  assertSuccess(
    await publicClient.waitForTransactionReceipt({ hash, timeout: TX_RECEIPT_TIMEOUT }),
    'acceptSubmission'
  );
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
  const publicClient = getPublicClient();
  const gas = await getGasParams(publicClient);
  const hash = await client.writeContract({
    address: config.CONTRACT_ADDRESS as `0x${string}`,
    abi: MARKET_ABI,
    functionName: 'rateTask',
    args: [taskId, requester, rating, workerAgentId, feedbackURI, feedbackHash],
    ...gas,
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    timeout: TX_RECEIPT_TIMEOUT,
  });
  assertSuccess(receipt, 'rateTask');
  return { hash, blockNumber: Number(receipt.blockNumber) };
}

export async function contractRegisterIdentity(): Promise<bigint> {
  const config = getServerConfig();
  const { client } = createServerWallet();
  const publicClient = getPublicClient();

  const gas = await getGasParams(publicClient);

  const hash = await client.writeContract({
    address: config.ERC8004_IDENTITY_REGISTRY as `0x${string}`,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'register',
    args: [],
    ...gas,
  });

  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    timeout: TX_RECEIPT_TIMEOUT,
  });
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

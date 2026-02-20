import { createPublicClient, http, formatUnits } from 'viem';
import { baseSepolia } from 'viem/chains';

const TASK_ID = '0x17506998816fffb9c2becde2b0e84fe9f20626a9d948831cf8e8753d7c791677' as `0x${string}`;
const CONTRACT = '0x77cf4Cf8a833194Fde217c778074b31b0782fF7E' as `0x${string}`;
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as `0x${string}`;

const MARKET_ABI = [
  {
    name: 'getTask',
    type: 'function',
    inputs: [{ name: 'taskId', type: 'bytes32' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'id', type: 'bytes32' },
        { name: 'requester', type: 'address' },
        { name: 'worker', type: 'address' },
        { name: 'reward', type: 'uint256' },
        { name: 'createdAt', type: 'uint256' },
        { name: 'expiryTime', type: 'uint256' },
        { name: 'status', type: 'uint8' },
        { name: 'rating', type: 'uint8' },
        { name: 'mode', type: 'uint8' },
        { name: 'stakeAmount', type: 'uint256' },
        { name: 'claimer', type: 'address' },
        { name: 'claimedAt', type: 'uint256' },
        { name: 'proposalDeadline', type: 'uint256' },
        { name: 'feeBps', type: 'uint16' },
      ],
    }],
    stateMutability: 'view',
  },
] as const;

const STATUS_MAP = ['Open', 'Claimed', 'WorkerSelected', 'PendingApproval', 'Accepted', 'Expired', 'Disputed'];
const MODE_MAP   = ['Contest', 'Instant', 'Proposal', 'Race'];

async function main() {
  const client = createPublicClient({ chain: baseSepolia, transport: http('https://sepolia.base.org') });

  console.log('=== On-Chain Task ===');
  const task = await client.readContract({ address: CONTRACT, abi: MARKET_ABI, functionName: 'getTask', args: [TASK_ID] });
  console.log('id:          ', task.id);
  console.log('requester:   ', task.requester);
  console.log('worker:      ', task.worker);
  console.log('reward:      ', formatUnits(task.reward, 6), 'USDC');
  console.log('createdAt:   ', new Date(Number(task.createdAt) * 1000).toISOString());
  console.log('expiryTime:  ', new Date(Number(task.expiryTime) * 1000).toISOString());
  console.log('status:      ', STATUS_MAP[task.status] ?? task.status);
  console.log('mode:        ', MODE_MAP[task.mode] ?? task.mode);
  console.log('feeBps:      ', task.feeBps, '=', Number(task.feeBps) / 100, '%');
  console.log('stakeAmount: ', formatUnits(task.stakeAmount, 6), 'USDC');

  console.log('\n=== Contract USDC Balance ===');
  const erc20Abi = [{ name: 'balanceOf', type: 'function', inputs: [{ name: 'a', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' }] as const;
  const contractBal = await client.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [CONTRACT] });
  console.log('TaskMarket USDC:', formatUnits(contractBal, 6), 'USDC');

  console.log('\n=== API Task Record ===');
  const apiRes = await fetch(`http://localhost:3000/trpc/tasks.get?input=${encodeURIComponent(JSON.stringify({ json: { taskId: TASK_ID } }))}`);
  if (apiRes.ok) {
    const data = await apiRes.json() as any;
    const t = data?.result?.data?.json;
    if (t) {
      console.log('id:          ', t.id);
      console.log('description: ', t.description);
      console.log('requester:   ', t.requester);
      console.log('reward:      ', t.reward);
      console.log('status:      ', t.status);
      console.log('escrowTxHash:', t.escrowTxHash);
      console.log('expiryTime:  ', t.expiryTime);
    }
  } else {
    console.log('API error:', apiRes.status, await apiRes.text());
  }
}
main().catch(console.error);

import { parseAbiItem } from 'viem';

export const TASK_COMPLETED_EVENT = parseAbiItem(
  'event TaskCompleted(bytes32 indexed taskId, address indexed requester, address indexed worker, uint256 workerPayment, uint256 platformFee)'
);

export const TASK_RATED_EVENT = parseAbiItem(
  'event TaskRated(bytes32 indexed taskId, address indexed worker, uint8 rating, uint256 raterAgentId)'
);

export const SETTLEMENT_READ_ABI = [
  {
    inputs: [{ name: 'taskId', type: 'bytes32' }],
    name: 'getTask',
    outputs: [
      {
        components: [
          { name: 'id', type: 'bytes32' },
          { name: 'requester', type: 'address' },
          { name: 'worker', type: 'address' },
          { name: 'status', type: 'uint8' },
          { name: 'mode', type: 'bytes4' },
          { name: 'reward', type: 'uint256' },
          { name: 'expiryTime', type: 'uint256' },
          { name: 'stakeAmount', type: 'uint256' },
          { name: 'feeBps', type: 'uint16' },
          { name: 'deliverable', type: 'bytes32' },
          { name: 'rating', type: 'uint8' },
          { name: 'hookContract', type: 'address' },
        ],
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'taskId', type: 'bytes32' }],
    name: 'getTaskVerdict',
    outputs: [
      {
        components: [
          { name: 'issued', type: 'bool' },
          { name: 'verdictType', type: 'uint8' },
          { name: 'score', type: 'uint16' },
          { name: 'confidence', type: 'uint16' },
          { name: 'criteriaFlags', type: 'bytes32[]' },
          { name: 'evidenceHash', type: 'bytes32' },
          {
            components: [
              { name: 'worker', type: 'address' },
              { name: 'amount', type: 'uint256' },
              { name: 'rank', type: 'uint16' },
            ],
            name: 'awards',
            type: 'tuple[]',
          },
        ],
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

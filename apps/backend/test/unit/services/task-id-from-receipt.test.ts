// Verifies: ADR-0045
// Verifies: ADR-0055
import { describe, expect, it, vi } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from 'viem';

// Hoisted, because the mock factories below are hoisted above ordinary top-level consts.
const { CONTRACT, receipt } = vi.hoisted(() => ({
  CONTRACT: '0x0000000000000000000000000000000000000001',
  receipt: { blockNumber: 100n, logs: [] as unknown[], status: 'success' },
}));

const HOOK = '0x00000000000000000000000000000000000000ff';
const REQUESTER = '0x1111111111111111111111111111111111111111';
const TASK_ID = `0x${'ab'.repeat(32)}` as const;
const OTHER_TASK_ID = `0x${'cd'.repeat(32)}` as const;
const TX_HASH = `0x${'ef'.repeat(32)}` as const;

vi.mock('../../../src/lib/rpc-gateway', () => ({
  getPublicClient: () => ({ getTransactionReceipt: async () => receipt }),
  runWithRpcApplicationAttempt: async (_label: string, fn: () => unknown) => fn(),
}));

vi.mock('../../../src/lib/wallet', () => ({
  createServerWallet: vi.fn(),
  dispatchServerWalletTransaction: vi.fn(),
}));

vi.mock('../../../src/config/env', () => ({
  getServerConfig: vi.fn().mockReturnValue({
    CHAIN_ID: 84532,
    CONTRACT_ADDRESS: CONTRACT,
    DEFAULT_PLATFORM_FEE_BPS: 500,
    FEE_RECIPIENT_ADDRESS: '0x0000000000000000000000000000000000000002',
    FORWARDER_ADDRESS: '0x0000000000000000000000000000000000000003',
    USDC_TOKEN_ADDRESS: '0x0000000000000000000000000000000000000004',
  }),
}));

import { taskIdForTx } from '../../../src/services/contract';

const CURRENT = parseAbiItem(
  'event TaskCreated(bytes32 indexed taskId, address indexed requester, uint256 reward, bytes4 indexed mode, uint256 expiryTime, bool stakeRequired, uint16 stakeBps)'
);
const PRE_REV014 = parseAbiItem(
  'event TaskCreated(bytes32 indexed taskId, address indexed requester, uint256 reward, bytes4 indexed mode, uint256 expiryTime)'
);

function taskCreatedLog(options: { address: string; taskId: `0x${string}`; legacy?: boolean }) {
  const abi = options.legacy ? PRE_REV014 : CURRENT;
  return {
    address: options.address,
    topics: encodeEventTopics({
      abi: [abi],
      args: { mode: '0x00000001', requester: REQUESTER, taskId: options.taskId },
    }),
    data: options.legacy
      ? encodeAbiParameters(
          [{ type: 'uint256' }, { type: 'uint256' }],
          [1_000_000n, 1_900_000_000n]
        )
      : encodeAbiParameters(
          [{ type: 'uint256' }, { type: 'uint256' }, { type: 'bool' }, { type: 'uint16' }],
          [1_000_000n, 1_900_000_000n, false, 0]
        ),
  };
}

describe('the task id a creation actually got', () => {
  it('reads it from the transaction TaskCreated log', async () => {
    receipt.logs = [taskCreatedLog({ address: CONTRACT, taskId: TASK_ID })];

    await expect(taskIdForTx(TX_HASH)).resolves.toBe(TASK_ID);
  });

  it('still reads it from a pre-rev014 log shape', async () => {
    // rev014 appended non-indexed fields, which changes topic0 -- so a single ABI silently
    // decodes nothing on the other side of that line, and the id looks absent rather than
    // different. The indexer keeps both for the same reason.
    receipt.logs = [taskCreatedLog({ address: CONTRACT, legacy: true, taskId: TASK_ID })];

    await expect(taskIdForTx(TX_HASH)).resolves.toBe(TASK_ID);
  });

  it('ignores a byte-identical log emitted by anything but the TaskMarket contract', async () => {
    // A requester-controlled hook runs inside the same transaction and can emit whatever it
    // likes. Taking the first decodable log would let it choose which task the entire
    // creation -- description, reward, allowed viewers, drop -- is written under.
    receipt.logs = [
      taskCreatedLog({ address: HOOK, taskId: OTHER_TASK_ID }),
      taskCreatedLog({ address: CONTRACT, taskId: TASK_ID }),
    ];

    await expect(taskIdForTx(TX_HASH)).resolves.toBe(TASK_ID);
  });

  it('refuses to invent one when the transaction created no task', async () => {
    // The alternative is writing a task row under a made-up id. Failing leaves the intent
    // claimable, which is the recoverable direction.
    receipt.logs = [taskCreatedLog({ address: HOOK, taskId: OTHER_TASK_ID })];

    await expect(taskIdForTx(TX_HASH)).rejects.toThrow('No TaskCreated log found');
  });
});

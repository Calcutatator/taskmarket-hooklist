import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/services/contract', () => ({
  contractTransferWithAuthorization: vi.fn().mockResolvedValue('0xdeadbeef'),
  contractGetDreamsClaimable: vi.fn().mockResolvedValue(500n * BigInt(10 ** 18)),
  contractWithdrawDreamsRewards: vi.fn().mockResolvedValue('0xcafebabe'),
  contractGetDreamsPerUsdc: vi.fn().mockResolvedValue(10n * BigInt(10 ** 18)),
  contractGetDreamsWorkerSplitBps: vi.fn().mockResolvedValue(8000),
  contractGetDreamsBonusBps: vi.fn().mockResolvedValue(750),
}));

vi.mock('../../../src/config/env', () => ({
  getServerConfig: vi.fn().mockReturnValue({
    CHAIN_ID: 84532,
    USDC_TOKEN_ADDRESS: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    USDC_DOMAIN_NAME: 'USDC',
    NODE_ENV: 'test',
    DREAMS_HOOK_ADDRESS: '0x1234567890123456789012345678901234567890',
  }),
}));

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    recoverMessageAddress: vi.fn(),
  };
});

import { walletRouter } from '../../../src/routers/wallet.router';
import {
  contractTransferWithAuthorization,
  contractGetDreamsClaimable,
  contractWithdrawDreamsRewards,
  contractGetDreamsPerUsdc,
} from '../../../src/services/contract';
import { recoverMessageAddress } from 'viem';
import { getServerConfig } from '../../../src/config/env';
import { createMockCtx, makeChain } from '../helpers';

const WALLET = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const WITHDRAWAL = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    address: WALLET,
    agentId: '42',
    completedTasks: 0,
    ratedTasks: 0,
    totalStars: 0,
    totalEarnings: '0',
    skills: [],
    withdrawalAddress: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

const nowSecs = Math.floor(Date.now() / 1000);
const validBefore = String(nowSecs + 300);
const validAfter = String(nowSecs - 60);

function makeAuthorization(overrides: Record<string, string> = {}) {
  return {
    from: WALLET,
    to: WITHDRAWAL,
    value: '5000000',
    validAfter,
    validBefore,
    nonce: '0x' + 'ab'.repeat(32),
    ...overrides,
  };
}

describe('wallet router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('setWithdrawalAddress', () => {
    it('sets withdrawal address when signature is valid', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WALLET as `0x${string}`);
      const ctx = createMockCtx();
      // Agent exists but no withdrawal address
      ctx.db.select.mockReturnValueOnce(makeChain([makeAgent({ withdrawalAddress: null })]));

      const caller = walletRouter.createCaller(ctx);
      const result = await caller.setWithdrawalAddress({
        walletAddress: WALLET,
        withdrawalAddress: WITHDRAWAL,
        signature: '0x' + 'aa'.repeat(65),
      });

      expect(result.withdrawalAddress).toBe(WITHDRAWAL);
      expect(ctx.db.insert).toHaveBeenCalledOnce();
    });

    it('throws UNAUTHORIZED when signature is from different wallet', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(
        '0x0000000000000000000000000000000000000001' as `0x${string}`
      );
      const ctx = createMockCtx();

      const caller = walletRouter.createCaller(ctx);
      await expect(
        caller.setWithdrawalAddress({
          walletAddress: WALLET,
          withdrawalAddress: WITHDRAWAL,
          signature: '0x' + 'aa'.repeat(65),
        })
      ).rejects.toThrow('Signature verification failed');
    });

    it('throws UNAUTHORIZED when recoverMessageAddress throws', async () => {
      vi.mocked(recoverMessageAddress).mockRejectedValueOnce(new Error('invalid sig'));
      const ctx = createMockCtx();

      const caller = walletRouter.createCaller(ctx);
      await expect(
        caller.setWithdrawalAddress({
          walletAddress: WALLET,
          withdrawalAddress: WITHDRAWAL,
          signature: '0xinvalid',
        })
      ).rejects.toThrow('Signature verification failed');
    });

    it('throws CONFLICT when withdrawal address is already set', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WALLET as `0x${string}`);
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeAgent({ withdrawalAddress: WITHDRAWAL })])
      );

      const caller = walletRouter.createCaller(ctx);
      await expect(
        caller.setWithdrawalAddress({
          walletAddress: WALLET,
          withdrawalAddress: WITHDRAWAL,
          signature: '0x' + 'aa'.repeat(65),
        })
      ).rejects.toThrow('already set');
    });
  });

  describe('getWithdrawalAddress', () => {
    it('returns null withdrawalAddress when agent is not in DB', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const caller = walletRouter.createCaller(ctx);
      const result = await caller.getWithdrawalAddress({ address: WALLET });

      expect(result.withdrawalAddress).toBeNull();
      expect(result.usdcDomain.chainId).toBe(84532);
      expect(result.usdcDomain.name).toBe('USDC');
    });

    it('returns set withdrawalAddress when agent has one', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeAgent({ withdrawalAddress: WITHDRAWAL })])
      );

      const caller = walletRouter.createCaller(ctx);
      const result = await caller.getWithdrawalAddress({ address: WALLET });

      expect(result.withdrawalAddress).toBe(WITHDRAWAL);
      expect(result.usdcDomain.verifyingContract).toBe(
        '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
      );
    });
  });

  describe('withdraw', () => {
    it('throws when authorization.from does not match input.from', async () => {
      const ctx = createMockCtx();
      const caller = walletRouter.createCaller(ctx);

      await expect(
        caller.withdraw({
          from: WALLET,
          amountBaseUnits: '5000000',
          authorization: makeAuthorization({ from: WITHDRAWAL }),
          signature: '0x' + 'aa'.repeat(65),
        })
      ).rejects.toThrow('authorization.from does not match from');
    });

    it('throws when agent has no withdrawal address', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeAgent({ withdrawalAddress: null })]));

      const caller = walletRouter.createCaller(ctx);
      await expect(
        caller.withdraw({
          from: WALLET,
          amountBaseUnits: '5000000',
          authorization: makeAuthorization(),
          signature: '0x' + 'aa'.repeat(65),
        })
      ).rejects.toThrow('No withdrawal address set');
    });

    it('throws when agent is not found', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const caller = walletRouter.createCaller(ctx);
      await expect(
        caller.withdraw({
          from: WALLET,
          amountBaseUnits: '5000000',
          authorization: makeAuthorization(),
          signature: '0x' + 'aa'.repeat(65),
        })
      ).rejects.toThrow('No withdrawal address set');
    });

    it('throws when authorization.to does not match registered withdrawal address', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeAgent({ withdrawalAddress: WITHDRAWAL })])
      );

      const caller = walletRouter.createCaller(ctx);
      await expect(
        caller.withdraw({
          from: WALLET,
          amountBaseUnits: '5000000',
          authorization: makeAuthorization({ to: '0x0000000000000000000000000000000000000001' }),
          signature: '0x' + 'aa'.repeat(65),
        })
      ).rejects.toThrow('authorization.to does not match registered withdrawal address');
    });

    it('throws when authorization.value does not match amountBaseUnits', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeAgent({ withdrawalAddress: WITHDRAWAL })])
      );

      const caller = walletRouter.createCaller(ctx);
      await expect(
        caller.withdraw({
          from: WALLET,
          amountBaseUnits: '5000000',
          authorization: makeAuthorization({ value: '9999999' }),
          signature: '0x' + 'aa'.repeat(65),
        })
      ).rejects.toThrow('authorization.value does not match amountBaseUnits');
    });

    it('throws when authorization has expired', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeAgent({ withdrawalAddress: WITHDRAWAL })])
      );

      const caller = walletRouter.createCaller(ctx);
      const pastValidBefore = String(Math.floor(Date.now() / 1000) - 10);

      await expect(
        caller.withdraw({
          from: WALLET,
          amountBaseUnits: '5000000',
          authorization: makeAuthorization({ validBefore: pastValidBefore }),
          signature: '0x' + 'aa'.repeat(65),
        })
      ).rejects.toThrow('expired');
    });

    it('executes transfer and returns txHash when all inputs are valid', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeAgent({ withdrawalAddress: WITHDRAWAL })])
      );

      const caller = walletRouter.createCaller(ctx);
      const result = await caller.withdraw({
        from: WALLET,
        amountBaseUnits: '5000000',
        authorization: makeAuthorization(),
        signature: '0x' + 'aa'.repeat(65),
      });

      expect(contractTransferWithAuthorization).toHaveBeenCalledOnce();
      expect(result.txHash).toBe('0xdeadbeef');
      expect(result.amountBaseUnits).toBe('5000000');
      expect(result.to).toBe(WITHDRAWAL);
    });
  });

  describe('dreamsBalance', () => {
    it('returns claimableBaseUnits when hook is configured', async () => {
      const ctx = createMockCtx();
      const caller = walletRouter.createCaller(ctx);
      const result = await caller.dreamsBalance({ address: WALLET });
      expect(contractGetDreamsClaimable).toHaveBeenCalledWith(WALLET);
      expect(result.claimableBaseUnits).toBe((500n * BigInt(10 ** 18)).toString());
    });

    it('returns "0" when DREAMS_HOOK_ADDRESS is not configured', async () => {
      const { getServerConfig } = await import('../../../src/config/env');
      // Override config to omit DREAMS_HOOK_ADDRESS for this test
      vi.mocked(getServerConfig).mockReturnValueOnce({
        CHAIN_ID: 84532,
        USDC_TOKEN_ADDRESS: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        USDC_DOMAIN_NAME: 'USDC',
        NODE_ENV: 'test' as const,
        DREAMS_HOOK_ADDRESS: undefined,
      } as unknown as ReturnType<typeof getServerConfig>);
      const ctx = createMockCtx();
      const caller = walletRouter.createCaller(ctx);
      const result = await caller.dreamsBalance({ address: WALLET });
      expect(result.claimableBaseUnits).toBe('0');
    });
  });

  describe('withdrawDreams', () => {
    const dreamsNonce = '0x' + 'cd'.repeat(32);

    it('executes withdrawal and returns txHash when signature and nonce are valid', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WALLET as `0x${string}`);
      const ctx = createMockCtx();
      ctx.db.insert.mockReturnValueOnce(makeChain([{ nonce: dreamsNonce }]));
      const caller = walletRouter.createCaller(ctx);
      const result = await caller.withdrawDreams({
        workerAddress: WALLET,
        destination: WITHDRAWAL,
        nonce: dreamsNonce,
        validBefore,
        signature: '0x' + 'aa'.repeat(65),
      });
      expect(contractWithdrawDreamsRewards).toHaveBeenCalledWith(WALLET, WITHDRAWAL);
      expect(result.txHash).toBe('0xcafebabe');
      expect(result.destination).toBe(WITHDRAWAL);
      expect(result.claimedBaseUnits).toBe((500n * BigInt(10 ** 18)).toString());
      expect(result.dreamsPerUsdc).toBe((10n * BigInt(10 ** 18)).toString());
      // 500 DREAMS / 10 DREAMS-per-USDC = 50 USDC = 50e6 base units
      expect(result.usdEquivalent).toBe((50n * BigInt(10 ** 6)).toString());
    });

    it('throws UNAUTHORIZED when signature is from different wallet', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(
        '0x0000000000000000000000000000000000000001' as `0x${string}`
      );
      const ctx = createMockCtx();
      const caller = walletRouter.createCaller(ctx);
      await expect(
        caller.withdrawDreams({
          workerAddress: WALLET,
          destination: WITHDRAWAL,
          nonce: dreamsNonce,
          validBefore,
          signature: '0x' + 'aa'.repeat(65),
        })
      ).rejects.toThrow('Signature verification failed');
    });

    it('throws BAD_REQUEST when claimable is zero', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WALLET as `0x${string}`);
      vi.mocked(contractGetDreamsClaimable).mockResolvedValueOnce(0n);
      const ctx = createMockCtx();
      ctx.db.insert.mockReturnValueOnce(makeChain([{ nonce: dreamsNonce }]));
      const caller = walletRouter.createCaller(ctx);
      await expect(
        caller.withdrawDreams({
          workerAddress: WALLET,
          destination: WITHDRAWAL,
          nonce: dreamsNonce,
          validBefore,
          signature: '0x' + 'aa'.repeat(65),
        })
      ).rejects.toThrow('No claimable DREAMS rewards');
    });

    it('throws BAD_REQUEST when the authorization has expired', async () => {
      const ctx = createMockCtx();
      const caller = walletRouter.createCaller(ctx);
      await expect(
        caller.withdrawDreams({
          workerAddress: WALLET,
          destination: WITHDRAWAL,
          nonce: dreamsNonce,
          validBefore: String(nowSecs - 1),
          signature: '0x' + 'aa'.repeat(65),
        })
      ).rejects.toThrow('Authorization has expired');
      // Expiry is checked before signature recovery, so it should never be reached.
      expect(recoverMessageAddress).not.toHaveBeenCalled();
    });

    it('throws CONFLICT when the nonce has already been used (replay)', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WALLET as `0x${string}`);
      const ctx = createMockCtx();
      // onConflictDoNothing inserts zero rows when the nonce already exists.
      ctx.db.insert.mockReturnValueOnce(makeChain([]));
      const caller = walletRouter.createCaller(ctx);
      await expect(
        caller.withdrawDreams({
          workerAddress: WALLET,
          destination: WITHDRAWAL,
          nonce: dreamsNonce,
          validBefore,
          signature: '0x' + 'aa'.repeat(65),
        })
      ).rejects.toThrow('Authorization nonce already used');
      expect(contractWithdrawDreamsRewards).not.toHaveBeenCalled();
    });
  });

  describe('exchangeRate', () => {
    it('returns dreamsPerUsdc when hook is configured', async () => {
      const ctx = createMockCtx();
      const caller = walletRouter.createCaller(ctx);
      const result = await caller.exchangeRate();
      expect(result.dreamsPerUsdc).toBe((10n * BigInt(10 ** 18)).toString());
      expect(result.workerSplitBps).toBe(8000);
      expect(result.bonusBps).toBe(750);
    });

    it('returns "0" when DREAMS_HOOK_ADDRESS is not configured', async () => {
      const { getServerConfig } = await import('../../../src/config/env');
      vi.mocked(getServerConfig).mockReturnValueOnce({
        CHAIN_ID: 84532,
        USDC_TOKEN_ADDRESS: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        USDC_DOMAIN_NAME: 'USDC',
        NODE_ENV: 'test' as const,
        DREAMS_HOOK_ADDRESS: undefined,
      } as unknown as ReturnType<typeof getServerConfig>);
      vi.mocked(contractGetDreamsPerUsdc).mockResolvedValueOnce(0n);
      const ctx = createMockCtx();
      const caller = walletRouter.createCaller(ctx);
      const result = await caller.exchangeRate();
      expect(result.dreamsPerUsdc).toBe('0');
    });
  });
});

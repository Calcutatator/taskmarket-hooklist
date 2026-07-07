import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createPublicClient, http, parseAbi, recoverMessageAddress } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { agents } from '../db/schema';
import { eq } from 'drizzle-orm';
import { getServerConfig } from '../config/env';
import {
  contractTransferWithAuthorization,
  contractGetDreamsClaimable,
  contractWithdrawDreamsRewards,
} from '../services/contract';
import {
  SetWithdrawalAddressInputSchema,
  SetWithdrawalAddressOutputSchema,
  GetWithdrawalAddressOutputSchema,
  WithdrawInputSchema,
  WithdrawOutputSchema,
  DreamsBalanceOutputSchema,
  WithdrawDreamsInputSchema,
  WithdrawDreamsOutputSchema,
} from '@taskmarket/shared';

const USDC_ABI = parseAbi(['function balanceOf(address) view returns (uint256)']);

export const walletRouter = router({
  balance: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/wallet/balance',
        tags: ['Wallet'],
        summary: 'Get USDC balance for an address',
      },
    })
    .input(z.object({ address: z.string() }))
    .output(
      z.object({ address: z.string(), balanceBaseUnits: z.string(), balanceUsdc: z.string() })
    )
    .query(async ({ input }) => {
      const config = getServerConfig();
      const chain = config.CHAIN_ID === 84532 ? baseSepolia : base;
      const publicClient = createPublicClient({ chain, transport: http(config.BASE_RPC_URL) });
      const raw = await publicClient.readContract({
        address: config.USDC_TOKEN_ADDRESS as `0x${string}`,
        abi: USDC_ABI,
        functionName: 'balanceOf',
        args: [input.address as `0x${string}`],
      });
      const balanceBaseUnits = raw.toString();
      const balanceUsdc = (Number(raw) / 1_000_000).toFixed(6);
      return { address: input.address, balanceBaseUnits, balanceUsdc };
    }),

  setWithdrawalAddress: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/wallet/set-withdrawal-address',
        tags: ['Wallet'],
        summary: 'Set withdrawal address (signed message auth, free)',
      },
    })
    .input(SetWithdrawalAddressInputSchema)
    .output(SetWithdrawalAddressOutputSchema)
    .mutation(async ({ input, ctx }) => {
      // Verify the signature: message must be signed by walletAddress
      const message = `taskmarket:set-withdrawal-address:${input.withdrawalAddress}`;
      let signer: string;
      try {
        signer = await recoverMessageAddress({
          message,
          signature: input.signature as `0x${string}`,
        });
      } catch {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Signature verification failed' });
      }

      if (signer.toLowerCase() !== input.walletAddress.toLowerCase()) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Signature verification failed' });
      }

      // Check if agent already has a withdrawal address set
      const existing = await ctx.db
        .select({ withdrawalAddress: agents.withdrawalAddress })
        .from(agents)
        .where(eq(agents.address, input.walletAddress))
        .limit(1);

      if (existing[0]?.withdrawalAddress) {
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            'Withdrawal address already set. To change it, use: taskmarket wallet change-withdrawal-address',
        });
      }

      // Upsert agent row with withdrawal address
      await ctx.db
        .insert(agents)
        .values({ address: input.walletAddress, withdrawalAddress: input.withdrawalAddress })
        .onConflictDoUpdate({
          target: agents.address,
          set: { withdrawalAddress: input.withdrawalAddress, updatedAt: new Date() },
        });

      return { withdrawalAddress: input.withdrawalAddress };
    }),

  getWithdrawalAddress: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/wallet/withdrawal-address',
        tags: ['Wallet'],
        summary: 'Get withdrawal address and USDC signing domain',
      },
    })
    .input(z.object({ address: z.string() }))
    .output(GetWithdrawalAddressOutputSchema)
    .query(async ({ input, ctx }) => {
      const config = getServerConfig();

      const result = await ctx.db
        .select({ withdrawalAddress: agents.withdrawalAddress })
        .from(agents)
        .where(eq(agents.address, input.address))
        .limit(1);

      const withdrawalAddress = result[0]?.withdrawalAddress ?? null;

      return {
        withdrawalAddress,
        usdcDomain: {
          name: config.USDC_DOMAIN_NAME,
          version: '2',
          chainId: config.CHAIN_ID,
          verifyingContract: config.USDC_TOKEN_ADDRESS,
        },
      };
    }),

  withdraw: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/wallet/withdraw',
        tags: ['Wallet'],
        summary: 'Withdraw USDC to registered withdrawal address via EIP-3009 authorization',
      },
    })
    .input(WithdrawInputSchema)
    .output(WithdrawOutputSchema)
    .mutation(async ({ input, ctx }) => {
      // Validate: authorization.from must match input.from
      if (input.authorization.from.toLowerCase() !== input.from.toLowerCase()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'authorization.from does not match from',
        });
      }

      // Look up agent; check withdrawal address is set
      const result = await ctx.db
        .select({ withdrawalAddress: agents.withdrawalAddress })
        .from(agents)
        .where(eq(agents.address, input.from))
        .limit(1);

      const agent = result[0];
      if (!agent?.withdrawalAddress) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'No withdrawal address set. Run: taskmarket wallet set-withdrawal-address <address>',
        });
      }

      // Validate: authorization.to must equal registered withdrawal address
      if (input.authorization.to.toLowerCase() !== agent.withdrawalAddress.toLowerCase()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'authorization.to does not match registered withdrawal address',
        });
      }

      // Validate: authorization.value must match amountBaseUnits
      if (BigInt(input.authorization.value) !== BigInt(input.amountBaseUnits)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'authorization.value does not match amountBaseUnits',
        });
      }

      // Validate: authorization must not be expired (validBefore > now + 6s)
      const validBefore = BigInt(input.authorization.validBefore);
      const nowSecs = BigInt(Math.floor(Date.now() / 1000));
      if (validBefore <= nowSecs + 6n) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Authorization has expired or expires too soon',
        });
      }

      const txHash = await contractTransferWithAuthorization(
        input.from as `0x${string}`,
        agent.withdrawalAddress as `0x${string}`,
        BigInt(input.amountBaseUnits),
        BigInt(input.authorization.validAfter),
        validBefore,
        input.authorization.nonce as `0x${string}`,
        input.signature
      );

      return {
        txHash,
        amountBaseUnits: input.amountBaseUnits,
        to: agent.withdrawalAddress,
      };
    }),

  dreamsBalance: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/wallet/dreams-balance',
        tags: ['Wallet'],
        summary: 'Get claimable DREAMS reward balance for an address',
      },
    })
    .input(z.object({ address: z.string() }))
    .output(DreamsBalanceOutputSchema)
    .query(async ({ input }) => {
      const config = getServerConfig();
      if (!config.DREAMS_HOOK_ADDRESS) {
        return { claimableBaseUnits: '0' };
      }
      const raw = await contractGetDreamsClaimable(input.address as `0x${string}`);
      return { claimableBaseUnits: raw.toString() };
    }),

  withdrawDreams: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/wallet/withdraw-dreams',
        tags: ['Wallet'],
        summary: 'Withdraw claimable DREAMS rewards to destination address (signed message auth)',
      },
    })
    .input(WithdrawDreamsInputSchema)
    .output(WithdrawDreamsOutputSchema)
    .mutation(async ({ input }) => {
      const config = getServerConfig();
      if (!config.DREAMS_HOOK_ADDRESS) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'DREAMS rewards are not configured on this server',
        });
      }

      // Verify the signature: message must be signed by workerAddress
      const message = `taskmarket:withdraw-dreams:${input.destination}`;
      let signer: string;
      try {
        signer = await recoverMessageAddress({
          message,
          signature: input.signature as `0x${string}`,
        });
      } catch {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Signature verification failed' });
      }
      if (signer.toLowerCase() !== input.workerAddress.toLowerCase()) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Signature verification failed' });
      }

      // Pre-flight: check there is something to claim (saves a tx)
      const claimable = await contractGetDreamsClaimable(input.workerAddress as `0x${string}`);
      if (claimable === 0n) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No claimable DREAMS rewards for this address',
        });
      }

      const txHash = await contractWithdrawDreamsRewards(
        input.workerAddress as `0x${string}`,
        input.destination as `0x${string}`
      );

      return {
        txHash,
        destination: input.destination,
        claimedBaseUnits: claimable.toString(),
      };
    }),
});

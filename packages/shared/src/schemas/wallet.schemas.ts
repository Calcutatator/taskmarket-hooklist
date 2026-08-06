import { z } from 'zod';
import { EthAddressSchema as EthAddress } from './common.schemas';

export const SetWithdrawalAddressInputSchema = z.object({
  walletAddress: EthAddress,
  withdrawalAddress: EthAddress,
  signature: z.string().min(1),
});

export const SetWithdrawalAddressOutputSchema = z.object({
  withdrawalAddress: z.string(),
});

const UsdcDomainSchema = z.object({
  name: z.string(),
  version: z.string(),
  chainId: z.number(),
  verifyingContract: z.string(),
});

export const GetWithdrawalAddressOutputSchema = z.object({
  withdrawalAddress: z.string().nullable(),
  usdcDomain: UsdcDomainSchema,
});

const AuthorizationSchema = z.object({
  from: z.string(),
  to: z.string(),
  value: z.string(),
  validAfter: z.string(),
  validBefore: z.string(),
  nonce: z.string(),
});

export const WithdrawInputSchema = z.object({
  from: EthAddress,
  amountBaseUnits: z.string().min(1),
  authorization: AuthorizationSchema,
  signature: z.string().min(1),
});

export const WithdrawOutputSchema = z.object({
  txHash: z.string(),
  amountBaseUnits: z.string(),
  to: z.string(),
});

export const DreamsBalanceOutputSchema = z.object({
  claimableBaseUnits: z.string(),
});

export const WithdrawDreamsInputSchema = z.object({
  workerAddress: EthAddress,
  destination: EthAddress,
  nonce: z.string().min(1),
  validBefore: z.string().min(1),
  signature: z.string().min(1),
});

export const WithdrawDreamsOutputSchema = z.object({
  txHash: z.string(),
  destination: z.string(),
  claimedBaseUnits: z.string(),
  dreamsPerUsdc: z.string(),
  usdEquivalent: z.string(),
});

export const ExchangeRateOutputSchema = z.object({
  dreamsPerUsdc: z.string(),
  // Both are read straight off `TaskTokenRewardHook`, which rejects either above 10000
  // (`InvalidBps`), and both are required here rather than optional: a client that had to
  // default the split would default it to the whole reward, and one that had to default the
  // bonus would report no bonus at all. Neither is a fact this endpoint may leave to the reader.
  workerSplitBps: z.number().int().min(0).max(10000),
  bonusBps: z.number().int().min(0).max(10000),
});

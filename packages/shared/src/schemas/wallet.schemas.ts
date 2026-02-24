import { z } from 'zod';

const EthAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address');

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

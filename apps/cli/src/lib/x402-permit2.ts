// Implements: ADR-0092
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from '@x402/core/types';
import { PERMIT2_ADDRESS, erc20AllowanceAbi } from '@x402/evm';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  getAddress,
  http,
  type LocalAccount,
  type PublicClient,
} from 'viem';

import type { X402PaymentPolicy, X402Policy, X402PolicyRule } from './x402-policy.js';
import { rpcUrlForNetwork } from './x402-policy.js';

const EIP2612_GAS_SPONSORING_KEY = 'eip2612GasSponsoring';
const ERC20_APPROVAL_GAS_SPONSORING_KEY = 'erc20ApprovalGasSponsoring';
const ERC20_APPROVE_GAS_LIMIT = 60_000n;

const erc20ApproveAbi = [
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const;

export type Permit2ApprovalMode =
  | 'not_required'
  | 'existing'
  | 'sponsored_eip2612'
  | 'sponsored_erc20'
  | 'direct';

export interface Permit2ApprovalResult {
  mode: Permit2ApprovalMode;
  allowance: string;
  targetAllowance: string;
  transaction?: `0x${string}`;
  gasCostWei?: string;
}

export interface Permit2ApprovalContext {
  policy: X402Policy;
  rule: X402PolicyRule;
  payment: X402PaymentPolicy;
  requirement: PaymentRequirements;
  paymentRequired: PaymentRequired;
  account: LocalAccount;
  nonInteractive: boolean;
  confirmDirectApproval: (details: {
    network: string;
    asset: string;
    spender: string;
    allowance: string;
    estimatedGasWei: string;
  }) => Promise<boolean>;
}

function chainIdOf(network: string): number {
  if (!/^eip155:[1-9]\d*$/.test(network)) throw new Error(`Invalid EVM network ${network}`);
  const chainId = Number(network.slice('eip155:'.length));
  if (!Number.isSafeInteger(chainId)) throw new Error(`EVM chain id is too large: ${network}`);
  return chainId;
}

export function isPermit2Requirement(requirement: PaymentRequirements): boolean {
  return requirement.scheme === 'upto' || requirement.extra?.['assetTransferMethod'] === 'permit2';
}

function hasExtension(paymentRequired: PaymentRequired, key: string): boolean {
  return Boolean(paymentRequired.extensions?.[key]);
}

function publicClientFor(policy: X402Policy, network: string): PublicClient {
  const chainId = chainIdOf(network);
  const rpcUrl = rpcUrlForNetwork(policy, network);
  const chain = defineChain({
    id: chainId,
    name: network,
    nativeCurrency: { name: 'Native gas token', symbol: 'GAS', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

export function rpcConfigurationByChainId(policy: X402Policy): Record<number, { rpcUrl: string }> {
  const entries: Array<[number, { rpcUrl: string }]> = [];
  for (const [network, configuration] of Object.entries(policy.networks)) {
    const rpcUrl = process.env[configuration.rpcUrlEnv]?.trim();
    if (!rpcUrl) continue;
    entries.push([chainIdOf(network), { rpcUrl }]);
  }
  return Object.fromEntries(entries);
}

export async function readPermit2Allowance(input: {
  policy: X402Policy;
  network: string;
  asset: string;
  owner: string;
}): Promise<bigint> {
  const publicClient = publicClientFor(input.policy, input.network);
  const rpcChainId = await publicClient.getChainId();
  const requiredChainId = chainIdOf(input.network);
  if (rpcChainId !== requiredChainId) {
    throw new Error(`RPC chain id ${rpcChainId} does not match ${input.network}`);
  }
  return (await publicClient.readContract({
    address: getAddress(input.asset),
    abi: erc20AllowanceAbi,
    functionName: 'allowance',
    args: [getAddress(input.owner), PERMIT2_ADDRESS],
  })) as bigint;
}

export async function ensurePermit2Approval(
  context: Permit2ApprovalContext
): Promise<Permit2ApprovalResult> {
  const { requirement, payment, paymentRequired } = context;
  if (!isPermit2Requirement(requirement)) {
    return { mode: 'not_required', allowance: '0', targetAllowance: '0' };
  }

  const allowance = await readPermit2Allowance({
    policy: context.policy,
    network: requirement.network,
    asset: requirement.asset,
    owner: context.account.address,
  });
  const required = BigInt(requirement.amount);
  const target = BigInt(payment.spendWindow.max);
  if (allowance >= required) {
    return {
      mode: 'existing',
      allowance: allowance.toString(),
      targetAllowance: target.toString(),
    };
  }

  const approvalPolicy = payment.permit2;
  if (!approvalPolicy) {
    throw new Error(
      `Permit2 allowance ${allowance} is below ${required}, and policy has no Permit2 approval settings`
    );
  }
  if (approvalPolicy.allowSponsoredApproval) {
    if (hasExtension(paymentRequired, EIP2612_GAS_SPONSORING_KEY)) {
      return {
        mode: 'sponsored_eip2612',
        allowance: allowance.toString(),
        targetAllowance: required.toString(),
      };
    }
    if (hasExtension(paymentRequired, ERC20_APPROVAL_GAS_SPONSORING_KEY)) {
      if (!approvalPolicy.maxApprovalGasWei) {
        throw new Error('Sponsored ERC-20 approval policy must set maxApprovalGasWei');
      }
      return {
        mode: 'sponsored_erc20',
        allowance: allowance.toString(),
        targetAllowance: target.toString(),
      };
    }
  }
  if (!approvalPolicy.allowDirectApproval) {
    throw new Error(
      `Permit2 allowance ${allowance} is below ${required}; direct approval is disabled by policy`
    );
  }
  if (context.nonInteractive && !approvalPolicy.allowUnattendedDirectApproval) {
    throw new Error('Permit2 direct approval requires interactive confirmation under this policy');
  }
  if (context.nonInteractive && !approvalPolicy.maxApprovalGasWei) {
    throw new Error('Permit2 direct approval policy must set maxApprovalGasWei');
  }

  const network = requirement.network;
  const chainId = chainIdOf(network);
  const rpcUrl = rpcUrlForNetwork(context.policy, network);
  const chain = defineChain({
    id: chainId,
    name: network,
    nativeCurrency: { name: 'Native gas token', symbol: 'GAS', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({
    account: context.account,
    chain,
    transport: http(rpcUrl),
  });
  const rpcChainId = await publicClient.getChainId();
  if (rpcChainId !== chainId)
    throw new Error(`RPC chain id ${rpcChainId} does not match ${network}`);

  const asset = getAddress(requirement.asset);
  const data = encodeFunctionData({
    abi: erc20ApproveAbi,
    functionName: 'approve',
    args: [PERMIT2_ADDRESS, target],
  });
  const gas = await publicClient.estimateGas({
    account: context.account,
    to: asset,
    data,
  });
  const fees = await publicClient.estimateFeesPerGas();
  const estimatedGasWei = gas * fees.maxFeePerGas;
  if (
    approvalPolicy.maxApprovalGasWei &&
    estimatedGasWei > BigInt(approvalPolicy.maxApprovalGasWei)
  ) {
    throw new Error(
      `Permit2 approval gas ${estimatedGasWei} exceeds policy cap ${approvalPolicy.maxApprovalGasWei}`
    );
  }
  const nativeBalance = await publicClient.getBalance({ address: context.account.address });
  if (nativeBalance < estimatedGasWei) {
    throw new Error(
      `Insufficient native gas balance for Permit2 approval: ${nativeBalance} < ${estimatedGasWei}`
    );
  }
  if (!context.nonInteractive) {
    const approved = await context.confirmDirectApproval({
      network,
      asset,
      spender: PERMIT2_ADDRESS,
      allowance: target.toString(),
      estimatedGasWei: estimatedGasWei.toString(),
    });
    if (!approved) throw new Error('Permit2 approval was declined');
  }
  const transaction = await walletClient.sendTransaction({
    account: context.account,
    chain,
    to: asset,
    data,
    gas,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: transaction });
  if (receipt.status !== 'success') throw new Error(`Permit2 approval reverted: ${transaction}`);
  return {
    mode: 'direct',
    allowance: allowance.toString(),
    targetAllowance: target.toString(),
    transaction,
    gasCostWei: receipt.gasUsed
      ? (receipt.gasUsed * receipt.effectiveGasPrice).toString()
      : estimatedGasWei.toString(),
  };
}

export function createBoundedApprovalExtension(input: {
  account: LocalAccount;
  policy: X402Policy;
  getApprovalTarget: (
    requirement: PaymentRequirements
  ) => { amount: string; maxGasWei: string } | undefined;
}) {
  return {
    key: ERC20_APPROVAL_GAS_SPONSORING_KEY,
    async enrichPaymentPayload(
      paymentPayload: PaymentPayload,
      paymentRequired: PaymentRequired
    ): Promise<PaymentPayload> {
      if (!paymentRequired.extensions?.[ERC20_APPROVAL_GAS_SPONSORING_KEY]) {
        return paymentPayload;
      }
      const requirement = paymentPayload.accepted;
      if (!isPermit2Requirement(requirement)) return paymentPayload;
      const approval = input.getApprovalTarget(requirement);
      if (!approval) return paymentPayload;
      const allowance = await readPermit2Allowance({
        policy: input.policy,
        network: requirement.network,
        asset: requirement.asset,
        owner: input.account.address,
      });
      if (allowance >= BigInt(requirement.amount)) return paymentPayload;

      const chainId = chainIdOf(requirement.network);
      const publicClient = publicClientFor(input.policy, requirement.network);
      const data = encodeFunctionData({
        abi: erc20ApproveAbi,
        functionName: 'approve',
        args: [PERMIT2_ADDRESS, BigInt(approval.amount)],
      });
      const [nonce, fees] = await Promise.all([
        publicClient.getTransactionCount({ address: input.account.address }),
        publicClient.estimateFeesPerGas(),
      ]);
      const maximumGasCost = ERC20_APPROVE_GAS_LIMIT * fees.maxFeePerGas;
      if (maximumGasCost > BigInt(approval.maxGasWei)) {
        throw new Error(
          `Sponsored Permit2 approval gas ${maximumGasCost} exceeds policy cap ${approval.maxGasWei}`
        );
      }
      const signedTransaction = await input.account.signTransaction({
        to: getAddress(requirement.asset),
        data,
        nonce,
        gas: ERC20_APPROVE_GAS_LIMIT,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        chainId,
        type: 'eip1559',
      });
      return {
        ...paymentPayload,
        extensions: {
          ...(paymentPayload.extensions ?? {}),
          [ERC20_APPROVAL_GAS_SPONSORING_KEY]: {
            info: {
              from: input.account.address,
              asset: getAddress(requirement.asset),
              spender: PERMIT2_ADDRESS,
              amount: approval.amount,
              signedTransaction,
              version: '1',
            },
          },
        },
      };
    },
  };
}

export function nonceFromPaymentPayload(payload: PaymentPayload): string | undefined {
  const schemePayload = payload.payload as Record<string, unknown>;
  const authorization = schemePayload['authorization'] as Record<string, unknown> | undefined;
  if (authorization?.['nonce']) return String(authorization['nonce']);
  const permit2 = schemePayload['permit2Authorization'] as Record<string, unknown> | undefined;
  if (permit2?.['nonce']) return String(permit2['nonce']);
  return undefined;
}

export function authorizationExpiryFromPaymentPayload(payload: PaymentPayload): string | undefined {
  const schemePayload = payload.payload as Record<string, unknown>;
  const authorization = schemePayload['authorization'] as Record<string, unknown> | undefined;
  if (authorization?.['validBefore'] && /^\d+$/.test(String(authorization['validBefore']))) {
    return new Date(Number(authorization['validBefore']) * 1000).toISOString();
  }
  const permit2 = schemePayload['permit2Authorization'] as Record<string, unknown> | undefined;
  if (permit2?.['deadline'] && /^\d+$/.test(String(permit2['deadline']))) {
    return new Date(Number(permit2['deadline']) * 1000).toISOString();
  }
  return undefined;
}

export function authorizationKindFromPaymentPayload(
  payload: PaymentPayload
): 'eip3009' | 'permit2' | undefined {
  const schemePayload = payload.payload as Record<string, unknown>;
  if (schemePayload['authorization']) return 'eip3009';
  if (schemePayload['permit2Authorization']) return 'permit2';
  return undefined;
}

// Implements: ADR-0092
import type {
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SettleResponse,
} from '@x402/core/types';
import { x402Client } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { UptoEvmScheme } from '@x402/evm/upto/client';
import { wrapFetchWithPayment } from '@x402/fetch';
import { randomUUID } from 'crypto';
import { getAddress, type LocalAccount } from 'viem';

import { createWalletAccountFromKeystore } from './signer.js';
import { loadKeystore } from './keystore.js';
import { ExternalX402Error } from './x402-errors.js';
import {
  externalResponseData,
  prepareX402HttpRequest,
  validateExternalX402Destination,
  type ExternalResponseData,
  type PreparedX402Request,
} from './x402-http.js';
import {
  getX402Payment,
  reserveX402Payment,
  transitionX402Payment,
  type X402PaymentRecord,
} from './x402-journal.js';
import {
  authorizeX402Requirement,
  loadX402Policy,
  type X402PaymentPolicy,
  type X402Policy,
  type X402PolicyAuthorization,
  type X402PolicyRule,
} from './x402-policy.js';
import {
  authorizationExpiryFromPaymentPayload,
  authorizationKindFromPaymentPayload,
  createBoundedApprovalExtension,
  ensurePermit2Approval,
  isPermit2Requirement,
  nonceFromPaymentPayload,
  rpcConfigurationByChainId,
} from './x402-permit2.js';

export interface ExternalX402PaymentTerms {
  origin: string;
  pathname: string;
  method: 'GET' | 'POST';
  scheme: string;
  network: string;
  asset: string;
  payTo: string;
  authorizedAmount: string;
  policyRuleId?: string;
  windowMaximum?: string;
  unattended: boolean;
}

export interface ExternalX402ExecutionOptions {
  rawUrl: string;
  method?: string;
  json?: string;
  bodyFile?: string;
  headers?: Record<string, string>;
  outputPath?: string;
  nonInteractive?: boolean;
  policyRuleId?: string;
  account?: LocalAccount;
  fetchImpl?: typeof globalThis.fetch;
  confirmPayment?: (terms: ExternalX402PaymentTerms) => Promise<boolean>;
  confirmDirectApproval?: (details: {
    network: string;
    asset: string;
    spender: string;
    allowance: string;
    estimatedGasWei: string;
  }) => Promise<boolean>;
}

export interface ExternalX402ExecutionResult {
  payment?: X402PaymentRecord;
  response: ExternalResponseData;
}

function sameRequirement(
  left: {
    scheme: string;
    network: string;
    amount: string;
    asset: string;
    payTo: string;
  },
  right: PaymentRequirements
): boolean {
  return (
    left.scheme === right.scheme &&
    left.network === right.network &&
    left.amount === right.amount &&
    left.asset.toLowerCase() === right.asset.toLowerCase() &&
    left.payTo.toLowerCase() === right.payTo.toLowerCase()
  );
}

function asPolicyRequirement(requirement: PaymentRequirements) {
  return {
    scheme: requirement.scheme,
    network: requirement.network,
    amount: requirement.amount,
    asset: requirement.asset,
    payTo: requirement.payTo,
    maxTimeoutSeconds: requirement.maxTimeoutSeconds,
    extra: requirement.extra,
  };
}

function validateRequirementShape(requirement: PaymentRequirements): void {
  if (!['exact', 'upto'].includes(requirement.scheme)) {
    throw new Error(`Unsupported x402 scheme: ${requirement.scheme}`);
  }
  if (!/^eip155:[1-9]\d*$/.test(requirement.network)) {
    throw new Error(`Unsupported x402 network: ${requirement.network}`);
  }
  if (!/^\d+$/.test(requirement.amount) || BigInt(requirement.amount) <= 0n) {
    throw new Error('x402 amount must be a positive integer string');
  }
  getAddress(requirement.asset);
  getAddress(requirement.payTo);
  if (
    !Number.isInteger(requirement.maxTimeoutSeconds) ||
    requirement.maxTimeoutSeconds <= 0 ||
    requirement.maxTimeoutSeconds > 3600
  ) {
    throw new Error('x402 maxTimeoutSeconds must be between 1 and 3600');
  }
  if (requirement.scheme === 'upto') {
    const facilitator = requirement.extra?.['facilitatorAddress'];
    if (typeof facilitator !== 'string') {
      throw new Error('x402 upto requirement is missing facilitatorAddress');
    }
    getAddress(facilitator);
  }
}

function transientAuthorization(input: {
  request: PreparedX402Request;
  requirement: PaymentRequirements;
}): X402PolicyAuthorization {
  const requirement = asPolicyRequirement(input.requirement);
  const payment: X402PaymentPolicy = {
    scheme: requirement.scheme as 'exact' | 'upto',
    network: requirement.network,
    asset: requirement.asset,
    maxPerPayment: requirement.amount,
    spendWindow: { seconds: requirement.maxTimeoutSeconds, max: requirement.amount },
    permit2: isPermit2Requirement(input.requirement)
      ? {
          allowSponsoredApproval: true,
          allowDirectApproval: true,
          allowUnattendedDirectApproval: false,
        }
      : undefined,
  };
  const rule: X402PolicyRule = {
    id: `interactive-${randomUUID()}`,
    enabled: true,
    priority: 0,
    origin: input.request.url.origin,
    pathPrefix: input.request.url.pathname,
    methods: [input.request.method],
    unattended: false,
    allowPrivateNetwork: false,
    maxAuthorizationSeconds: requirement.maxTimeoutSeconds,
    payments: [payment],
  };
  return {
    rule,
    payment,
    requirement,
    windowStartedAt: new Date(Date.now() - requirement.maxTimeoutSeconds * 1000).toISOString(),
  };
}

function privateNetworkAllowed(input: {
  policy: X402Policy;
  request: PreparedX402Request;
  requestedRuleId?: string;
}): boolean {
  const matches = input.policy.rules.filter(
    (rule) =>
      rule.enabled &&
      (!input.requestedRuleId || rule.id === input.requestedRuleId) &&
      rule.origin === input.request.url.origin &&
      input.request.url.pathname.startsWith(rule.pathPrefix) &&
      rule.methods.includes(input.request.method)
  );
  if (matches.length === 0) return false;
  const priority = Math.max(...matches.map((rule) => rule.priority));
  const winners = matches.filter((rule) => rule.priority === priority);
  return winners.length === 1 && winners[0].allowPrivateNetwork;
}

function resourceMatchesRequest(paymentRequired: PaymentRequired, request: PreparedX402Request) {
  if (!paymentRequired.resource?.url) throw new Error('x402 challenge is missing resource.url');
  const challengeUrl = new URL(paymentRequired.resource.url);
  if (challengeUrl.toString() !== request.url.toString()) {
    throw new Error(
      `x402 challenge resource does not match request: ${challengeUrl} != ${request.url}`
    );
  }
}

function nonceFromPayload(payload: PaymentPayload): string | undefined {
  return nonceFromPaymentPayload(payload);
}

function settledAmountFor(
  record: X402PaymentRecord,
  settlement: SettleResponse
): string | undefined {
  if (settlement.network !== record.network) return undefined;
  if (settlement.payer && settlement.payer.toLowerCase() !== record.payer.toLowerCase()) {
    return undefined;
  }
  if (record.scheme === 'exact') {
    if (settlement.amount !== undefined && settlement.amount !== record.authorizedAmount) {
      return undefined;
    }
    if (!/^0x[a-fA-F0-9]{64}$/.test(settlement.transaction)) return undefined;
    return record.authorizedAmount;
  }
  if (settlement.amount === undefined || !/^\d+$/.test(settlement.amount)) return undefined;
  if (BigInt(settlement.amount) > BigInt(record.authorizedAmount)) return undefined;
  if (BigInt(settlement.amount) > 0n && !/^0x[a-fA-F0-9]{64}$/.test(settlement.transaction)) {
    return undefined;
  }
  return settlement.amount;
}

function signerFor(account: LocalAccount) {
  return {
    address: account.address,
    signTypedData: async (typedData: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }) => account.signTypedData(typedData as Parameters<typeof account.signTypedData>[0]),
  };
}

export async function executeExternalX402Request(
  options: ExternalX402ExecutionOptions
): Promise<ExternalX402ExecutionResult> {
  const nonInteractive = Boolean(options.nonInteractive);
  const request = await prepareX402HttpRequest({
    rawUrl: options.rawUrl,
    method: options.method ?? 'GET',
    json: options.json,
    bodyFile: options.bodyFile,
    headers: options.headers,
  });
  const policy = await loadX402Policy(undefined, { allowMissing: !nonInteractive });
  if (options.policyRuleId && !policy.rules.some((rule) => rule.id === options.policyRuleId)) {
    throw new Error(`x402 policy rule '${options.policyRuleId}' was not found`);
  }
  const allowPrivateNetwork = privateNetworkAllowed({
    policy,
    request,
    requestedRuleId: options.policyRuleId,
  });
  await validateExternalX402Destination(request.url, { allowPrivateNetwork });

  const account = options.account ?? (await createWalletAccountFromKeystore(await loadKeystore()));
  const rpcOptions = rpcConfigurationByChainId(policy);
  let selectedAuthorization: X402PolicyAuthorization | undefined;
  let paymentRecord: X402PaymentRecord | undefined;
  let paymentPayload: PaymentPayload | undefined;
  let approvalTarget: { amount: string; maxGasWei: string } | undefined;
  let paidRequestDispatched = false;

  const client = new x402Client((version, requirements) => {
    if (version !== 2) throw new Error(`Unsupported x402 version: ${version}`);
    const authorized: Array<{
      requirement: PaymentRequirements;
      authorization: X402PolicyAuthorization;
      paymentIndex: number;
    }> = [];
    for (const requirement of requirements) {
      try {
        validateRequirementShape(requirement);
        const authorization = authorizeX402Requirement({
          policy,
          url: request.url,
          method: request.method,
          requirement: asPolicyRequirement(requirement),
          nonInteractive,
          requestedRuleId: options.policyRuleId,
        });
        authorized.push({
          requirement,
          authorization,
          paymentIndex: authorization.rule.payments.indexOf(authorization.payment),
        });
      } catch {
        continue;
      }
    }
    authorized.sort(
      (left, right) =>
        right.authorization.rule.priority - left.authorization.rule.priority ||
        left.paymentIndex - right.paymentIndex
    );
    if (authorized[0]) {
      selectedAuthorization = authorized[0].authorization;
      return authorized[0].requirement;
    }
    if (nonInteractive || options.policyRuleId) {
      throw new Error('No advertised x402 payment option is authorized by policy');
    }
    const fallback = requirements.find((requirement) => {
      try {
        validateRequirementShape(requirement);
        return true;
      } catch {
        return false;
      }
    });
    if (!fallback) throw new Error('No supported EVM exact or upto payment option was advertised');
    selectedAuthorization = transientAuthorization({ request, requirement: fallback });
    return fallback;
  });

  const officialSigner = signerFor(account);
  client.register('eip155:*', new ExactEvmScheme(officialSigner, rpcOptions));
  client.register('eip155:*', new UptoEvmScheme(officialSigner, rpcOptions));
  client.registerExtension(
    createBoundedApprovalExtension({
      account,
      policy,
      getApprovalTarget: (requirement) =>
        approvalTarget && paymentPayload === undefined && requirement ? approvalTarget : undefined,
    })
  );

  client.onBeforePaymentCreation(async ({ paymentRequired, selectedRequirements }) => {
    if (paymentRequired.x402Version !== 2) {
      return { abort: true, reason: `Unsupported x402 version: ${paymentRequired.x402Version}` };
    }
    resourceMatchesRequest(paymentRequired, request);
    validateRequirementShape(selectedRequirements);
    if (
      !selectedAuthorization ||
      !sameRequirement(selectedAuthorization.requirement, selectedRequirements)
    ) {
      selectedAuthorization = nonInteractive
        ? authorizeX402Requirement({
            policy,
            url: request.url,
            method: request.method,
            requirement: asPolicyRequirement(selectedRequirements),
            nonInteractive,
            requestedRuleId: options.policyRuleId,
          })
        : transientAuthorization({ request, requirement: selectedRequirements });
    }
    if (!nonInteractive) {
      if (!options.confirmPayment) {
        return { abort: true, reason: 'Interactive x402 payment confirmation is unavailable' };
      }
      const approved = await options.confirmPayment({
        origin: request.url.origin,
        pathname: request.url.pathname,
        method: request.method,
        scheme: selectedRequirements.scheme,
        network: selectedRequirements.network,
        asset: selectedRequirements.asset,
        payTo: selectedRequirements.payTo,
        authorizedAmount: selectedRequirements.amount,
        policyRuleId: selectedAuthorization.rule.id.startsWith('interactive-')
          ? undefined
          : selectedAuthorization.rule.id,
        windowMaximum: selectedAuthorization.payment.spendWindow.max,
        unattended: false,
      });
      if (!approved) return { abort: true, reason: 'External x402 payment was declined' };
    }
    paymentRecord = await reserveX402Payment({
      authorization: selectedAuthorization,
      url: request.url,
      method: request.method,
      requestHash: request.requestHash,
      payer: account.address,
    });
    if (isPermit2Requirement(selectedRequirements)) {
      paymentRecord = await transitionX402Payment(paymentRecord.id, {
        state: 'approval_pending',
      });
      const approval = await ensurePermit2Approval({
        policy,
        rule: selectedAuthorization.rule,
        payment: selectedAuthorization.payment,
        requirement: selectedRequirements,
        paymentRequired,
        account,
        nonInteractive,
        confirmDirectApproval:
          options.confirmDirectApproval ?? (async () => Promise.resolve(false)),
      });
      approvalTarget =
        approval.mode === 'sponsored_erc20'
          ? {
              amount: approval.targetAllowance,
              maxGasWei: selectedAuthorization.payment.permit2!.maxApprovalGasWei!,
            }
          : undefined;
      paymentRecord = await transitionX402Payment(paymentRecord.id, {
        state: 'reserved',
        approvalMode: approval.mode,
        approvalPreviousAllowance: approval.allowance,
        approvalTargetAllowance: approval.targetAllowance,
        approvalTransaction: approval.transaction,
        approvalGasCostWei: approval.gasCostWei,
      });
    }
  });

  client.onAfterPaymentCreation(async ({ paymentPayload: createdPayload }) => {
    paymentPayload = createdPayload;
    if (!paymentRecord) throw new Error('x402 payment payload was created without a reservation');
    paymentRecord = await transitionX402Payment(paymentRecord.id, {
      state: 'ready',
      nonce: nonceFromPayload(createdPayload),
      authorizationKind: authorizationKindFromPaymentPayload(createdPayload),
      authorizationExpiresAt: authorizationExpiryFromPaymentPayload(createdPayload),
    });
  });

  client.onPaymentCreationFailure(async ({ error }) => {
    if (paymentRecord && !paidRequestDispatched) {
      paymentRecord = await transitionX402Payment(paymentRecord.id, {
        state: 'failed_before_dispatch',
        error: error.message,
      });
    }
  });

  client.onPaymentResponse(async ({ settleResponse, error, paymentRequired }) => {
    if (!paymentRecord) return;
    if (settleResponse?.success) {
      const settledAmount = settledAmountFor(paymentRecord, settleResponse);
      if (settledAmount === undefined) {
        paymentRecord = await transitionX402Payment(paymentRecord.id, {
          state: 'settled_amount_unknown',
          transaction: settleResponse.transaction || undefined,
          error: 'Settlement response omitted or invalidated the actual amount',
        });
        return;
      }
      paymentRecord = await transitionX402Payment(paymentRecord.id, {
        state: 'settled',
        settledAmount,
        transaction: settleResponse.transaction || undefined,
      });
      return;
    }
    const reason =
      error?.message ??
      settleResponse?.errorMessage ??
      settleResponse?.errorReason ??
      paymentRequired?.error ??
      'Paid request returned no settlement evidence';
    paymentRecord = await transitionX402Payment(paymentRecord.id, {
      state: 'unknown',
      transaction: settleResponse?.transaction || undefined,
      error: reason,
    });
  });

  const underlyingFetch = options.fetchImpl ?? globalThis.fetch;
  const guardedFetch: typeof globalThis.fetch = async (input, init) => {
    const outgoing = new Request(input, { ...init, redirect: 'error' });
    const isPaid = outgoing.headers.has('payment-signature') || outgoing.headers.has('x-payment');
    await validateExternalX402Destination(request.url, { allowPrivateNetwork });
    if (isPaid) {
      if (!paymentRecord) throw new Error('Paid x402 request has no journal reservation');
      paidRequestDispatched = true;
      paymentRecord = await transitionX402Payment(paymentRecord.id, { state: 'dispatched' });
    }
    try {
      return await underlyingFetch(outgoing);
    } catch (error) {
      if (isPaid && paymentRecord) {
        paymentRecord = await transitionX402Payment(paymentRecord.id, {
          state: 'unknown',
          error: error instanceof Error ? error.message : String(error),
        });
        throw new ExternalX402Error('External x402 outcome is unknown; do not retry', {
          cause: error,
          payment: paymentRecord,
          pending: true,
        });
      }
      throw error;
    }
  };
  const paidFetch = wrapFetchWithPayment(guardedFetch, client);
  let response: Response;
  try {
    response = await paidFetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'error',
    });
  } catch (error) {
    if (error instanceof ExternalX402Error) throw error;
    if (paymentRecord) {
      const current = await getX402Payment(paymentRecord.id);
      if (['ready', 'dispatched', 'unknown'].includes(current.state) || paidRequestDispatched) {
        paymentRecord = await transitionX402Payment(paymentRecord.id, {
          state: 'unknown',
          error: error instanceof Error ? error.message : String(error),
        });
        throw new ExternalX402Error('External x402 outcome is unknown; do not retry', {
          cause: error,
          payment: paymentRecord,
          pending: true,
        });
      }
    }
    throw new ExternalX402Error(
      error instanceof Error ? error.message : 'External x402 request failed',
      { cause: error, payment: paymentRecord, pending: false }
    );
  }

  if (paymentRecord) {
    paymentRecord = await getX402Payment(paymentRecord.id);
    if (paymentRecord.state !== 'settled') {
      throw new ExternalX402Error('External x402 outcome is unknown; do not retry', {
        payment: paymentRecord,
        pending: true,
        status: response.status,
      });
    }
  }
  let responseData: ExternalResponseData;
  try {
    responseData = await externalResponseData(response, { outputPath: options.outputPath });
  } catch (error) {
    if (paymentRecord) {
      throw new ExternalX402Error(
        error instanceof Error ? error.message : 'Failed to process external response',
        { cause: error, payment: paymentRecord, pending: false, status: response.status }
      );
    }
    throw error;
  }
  if (!response.ok) {
    throw new ExternalX402Error(`External service returned HTTP ${response.status}`, {
      payment: paymentRecord,
      pending: false,
      status: response.status,
    });
  }
  return { payment: paymentRecord, response: responseData };
}

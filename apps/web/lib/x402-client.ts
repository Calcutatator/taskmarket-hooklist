// Reusable browser X402 payment flow.
//
// Mirrors the probe-then-sign-then-retry flow from wizard/step-publish.tsx
// so any X402-paid action button can call payX402Post() instead of
// duplicating the full 90-line dance.

import { IDEMPOTENCY_KEY_HEADER } from '@taskmarket/shared';
import type { useSignTypedData, useSwitchChain } from 'wagmi';
import { getLegalRequestHeaders } from '@/lib/legal-receipt';
import { newIdempotencyKey } from '@/lib/api/idempotency';
import {
  isPendingTransactionMessage,
  isPendingWriteResponse,
  type PendingWriteResult,
} from '@/lib/relayed-write-outcome';

export type X402Step = 'payment' | 'signing' | 'submitting';

export type X402Deps = {
  address: `0x${string}`;
  apiUrl: string;
  signTypedDataAsync: ReturnType<typeof useSignTypedData>['signTypedDataAsync'];
  switchChainAsync: ReturnType<typeof useSwitchChain>['switchChainAsync'];
};

export type X402Success<T> = {
  ok: true;
  data: T;
  idempotencyKey: string;
  txHash?: string;
};

/**
 * The write was broadcast and no terminal outcome has been established (ADR-0049 point 3).
 * It is neither a success nor a failure, and a caller must never resubmit on it: a resubmit
 * is a second x402 payment, not a retry. The idempotency key is the handle to poll with,
 * because it exists before the request is sent and therefore survives a response that never
 * arrived (ADR-0052).
 */
export type X402Pending = PendingWriteResult;

export type X402Failure = {
  ok: false;
  pending?: false;
  error: string;
  idempotencyKey?: string;
  rejected?: boolean;
};

export type X402Result<T> = X402Success<T> | X402Pending | X402Failure;

// Re-exported so existing callers keep their import, but the body lives in
// `relayed-write-outcome.ts`: x402 is only one of three transports that has to recognise this
// outcome, and there must be exactly one place to change when the backend gains a structured
// discriminator.
export { isPendingTransactionMessage };

type Eip712Domain = {
  chainId: number | string;
  name: string;
  version: string;
  verifyingContract: string;
};

type Eip712Types = Record<string, Array<{ name: string; type: string }>>;

type AcceptedPayment = {
  amount: string;
  asset: string;
  maxTimeoutSeconds?: number;
  network: string;
  payTo: string;
  scheme: string;
  extra?: {
    eip712?: {
      domain: Eip712Domain;
      types: Eip712Types;
    };
  };
};

type PaymentChallenge = {
  accepts?: AcceptedPayment[];
};

function randomNonce(): `0x${string}` {
  return `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}` as `0x${string}`;
}

function isUserRejected(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code === 4001) return true;
  const msg = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  return msg.includes('user rejected') || msg.includes('user denied');
}

export async function payX402Post<T = unknown>(
  path: string,
  body: Record<string, unknown>,
  deps: X402Deps,
  onStep?: (step: X402Step) => void,
  // Supplied by a caller that wants one logical write to keep the same key across an
  // ambiguous outcome, so pressing the button again presents the write the backend already
  // has rather than a second one. Minted per call when absent.
  idempotencyKey: string = newIdempotencyKey()
): Promise<X402Result<T>> {
  // Flipped the instant the paid request leaves the browser, and never cleared. Everything
  // before it is preparation the backend never saw -- a failed probe, a rejected signature, a
  // malformed challenge -- and reporting those as in flight would tell a user to wait for a
  // write that never started. Everything after it is ambiguous by construction: the payment
  // has settled and the write may be landing, so a thrown fetch, a socket dying mid-body, or a
  // `submitRes.json()` that never parses says nothing about whether the write took effect.
  // The boundary is the dispatch itself rather than the response, because that is the moment
  // the money and the write stop being ours to take back.
  let dispatched = false;
  try {
    onStep?.('payment');
    const probeRes = await fetch(`${deps.apiUrl}${path}`, {
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        ...(await getLegalRequestHeaders()),
        [IDEMPOTENCY_KEY_HEADER]: idempotencyKey,
      },
      method: 'POST',
    });
    if (probeRes.status !== 402) {
      const text = await probeRes.text().catch(() => '');
      return {
        ok: false,
        error: `Expected payment challenge (402), got ${probeRes.status}${text ? ': ' + text.slice(0, 200) : ''}`,
      };
    }

    const payReq = (await probeRes.json()) as PaymentChallenge;
    const accepted = payReq.accepts?.[0];
    const eip712 = accepted?.extra?.eip712;
    if (!accepted || !eip712?.domain) {
      return { ok: false, error: 'Payment challenge did not include EIP-712 terms' };
    }

    onStep?.('signing');
    const requiredChainId = Number(eip712.domain.chainId);
    try {
      await deps.switchChainAsync({ chainId: requiredChainId });
    } catch {
      // Fall back to raw provider call if wagmi doesn't know the chain.
      const provider = (
        window as Window & {
          ethereum?: {
            request?: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
          };
        }
      ).ethereum;
      await provider?.request?.({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${requiredChainId.toString(16)}` }],
      });
    }

    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 300);
    const nonce = randomNonce();

    let signature: `0x${string}`;
    try {
      signature = await deps.signTypedDataAsync({
        domain: {
          chainId: requiredChainId,
          name: eip712.domain.name,
          verifyingContract: eip712.domain.verifyingContract as `0x${string}`,
          version: eip712.domain.version,
        },
        message: {
          from: deps.address,
          nonce,
          to: accepted.payTo as `0x${string}`,
          validAfter: 0n,
          validBefore,
          value: BigInt(accepted.amount),
        },
        primaryType: 'TransferWithAuthorization',
        types: { TransferWithAuthorization: eip712.types.TransferWithAuthorization },
      });
    } catch (err) {
      if (isUserRejected(err)) {
        return { ok: false, error: 'Cancelled in wallet', rejected: true };
      }
      throw err;
    }

    const paymentPayload = {
      accepted: {
        amount: accepted.amount,
        asset: accepted.asset,
        maxTimeoutSeconds: accepted.maxTimeoutSeconds,
        network: accepted.network,
        payTo: accepted.payTo,
        scheme: accepted.scheme,
      },
      network: accepted.network,
      payload: {
        authorization: {
          from: deps.address,
          nonce,
          to: accepted.payTo,
          validAfter: '0',
          validBefore: validBefore.toString(),
          value: accepted.amount,
        },
        signature,
      },
      scheme: accepted.scheme,
      x402Version: 2,
    };

    onStep?.('submitting');
    dispatched = true;
    const submitRes = await fetch(`${deps.apiUrl}${path}`, {
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        ...(await getLegalRequestHeaders()),
        [IDEMPOTENCY_KEY_HEADER]: idempotencyKey,
        'payment-signature': btoa(JSON.stringify(paymentPayload)),
      },
      method: 'POST',
    });
    if (!submitRes.ok) {
      const errBody = (await submitRes.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      const error = errBody.message ?? errBody.error ?? `Server error: ${submitRes.status}`;
      if (isPendingWriteResponse(errBody, error)) {
        return { ok: false, pending: true, idempotencyKey, error };
      }
      return { ok: false, error, idempotencyKey };
    }

    const data = (await submitRes.json()) as T & { txHash?: string };
    return { ok: true, data, idempotencyKey, txHash: data.txHash };
  } catch (err) {
    // A cancellation is never in flight, whichever side of dispatch it surfaces on: the user
    // declined in the wallet, so nothing was paid and nothing was sent.
    if (isUserRejected(err)) {
      return { ok: false, error: 'Cancelled in wallet', idempotencyKey, rejected: true };
    }
    const error = err instanceof Error ? err.message : 'X402 request failed';
    if (dispatched) {
      return { ok: false, pending: true, idempotencyKey, error };
    }
    return { ok: false, error, idempotencyKey };
  }
}

/**
 * Returns the amount in USDC base units (6 decimals) as a string,
 * which is what the X402 challenge sends back in `accepts[0].amount`.
 * Use this to display a "Costs N USDC" badge BEFORE the user signs.
 *
 * If you don't want to probe twice, store a static cost constant per
 * endpoint instead.
 */
export async function probeX402Cost(
  path: string,
  body: Record<string, unknown>,
  apiUrl: string,
  idempotencyKey: string = newIdempotencyKey()
): Promise<string | null> {
  try {
    const probeRes = await fetch(`${apiUrl}${path}`, {
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        ...(await getLegalRequestHeaders()),
        [IDEMPOTENCY_KEY_HEADER]: idempotencyKey,
      },
      method: 'POST',
    });
    if (probeRes.status !== 402) return null;
    const payReq = (await probeRes.json()) as PaymentChallenge;
    return payReq.accepts?.[0]?.amount ?? null;
  } catch {
    return null;
  }
}

// Reusable browser X402 payment flow.
//
// Mirrors the probe-then-sign-then-retry flow from wizard/step-publish.tsx
// so any X402-paid action button can call payX402Post() instead of
// duplicating the full 90-line dance.

import type { useSignTypedData, useSwitchChain } from 'wagmi';

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
  txHash?: string;
};

export type X402Failure = {
  ok: false;
  error: string;
  rejected?: boolean;
};

export type X402Result<T> = X402Success<T> | X402Failure;

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
  onStep?: (step: X402Step) => void
): Promise<X402Result<T>> {
  try {
    onStep?.('payment');
    const probeRes = await fetch(`${deps.apiUrl}${path}`, {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
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
    const submitRes = await fetch(`${deps.apiUrl}${path}`, {
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': btoa(JSON.stringify(paymentPayload)),
      },
      method: 'POST',
    });
    if (!submitRes.ok) {
      const errBody = (await submitRes.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      return {
        ok: false,
        error: errBody.message ?? errBody.error ?? `Server error: ${submitRes.status}`,
      };
    }

    const data = (await submitRes.json()) as T & { txHash?: string };
    return { ok: true, data, txHash: data.txHash };
  } catch (err) {
    if (isUserRejected(err)) {
      return { ok: false, error: 'Cancelled in wallet', rejected: true };
    }
    return { ok: false, error: err instanceof Error ? err.message : 'X402 request failed' };
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
  apiUrl: string
): Promise<string | null> {
  try {
    const probeRes = await fetch(`${apiUrl}${path}`, {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (probeRes.status !== 402) return null;
    const payReq = (await probeRes.json()) as PaymentChallenge;
    return payReq.accepts?.[0]?.amount ?? null;
  } catch {
    return null;
  }
}

// Helper for the wallet-signed action pattern (no payment).
//
// The signed message is always `taskmarket:<verb>:<taskId>` for task
// actions, matching what the CLI signs in apps/cli/src/commands/task/*.
// The POST body includes the signature plus whatever extra fields the
// caller passes in. The signer address is sent as either workerAddress
// (worker actions) or requesterAddress (requester actions) — pass
// addressField to control that.

import { IDEMPOTENCY_KEY_HEADER } from '@taskmarket/shared';
import type { useSignMessage } from 'wagmi';
import { getLegalRequestHeaders } from '@/lib/legal-receipt';
import { newIdempotencyKey } from '@/lib/api/idempotency';
import { isPendingWriteResponse, type PendingWriteResult } from '@/lib/relayed-write-outcome';

export type WalletSignDeps = {
  address: `0x${string}`;
  apiUrl: string;
  signMessageAsync: ReturnType<typeof useSignMessage>['signMessageAsync'];
};

export type WalletSignResult<T> =
  | { ok: true; data: T; txHash?: string; idempotencyKey: string }
  // These writes are relayed but unpaid, so an in-flight outcome costs no money. It is still
  // not a failure, and resubmitting still creates a second write rather than a retry, so the
  // caller has to be able to tell the states apart here too (ADR-0045).
  | PendingWriteResult
  | { ok: false; pending?: false; error: string; rejected?: boolean; idempotencyKey?: string };

type AddressField = 'workerAddress' | 'requesterAddress';

function isUserRejected(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code === 4001) return true;
  const msg = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  return msg.includes('user rejected') || msg.includes('user denied');
}

export async function signAndPost<T = unknown>(args: {
  path: string;
  verbForMessage: string;
  taskId: string;
  extraBody?: Record<string, unknown>;
  addressField?: AddressField;
  deps: WalletSignDeps;
  // Supplied by a caller that wants one logical write to keep the same key across an
  // ambiguous outcome, so pressing the button again presents the write the backend already
  // has rather than starting a second one. Minted per call when absent.
  idempotencyKey?: string;
}): Promise<WalletSignResult<T>> {
  const addressField = args.addressField ?? 'workerAddress';
  const message = `taskmarket:${args.verbForMessage}:${args.taskId}`;
  const idempotencyKey = args.idempotencyKey ?? newIdempotencyKey();

  let signature: string;
  try {
    signature = await args.deps.signMessageAsync({ message });
  } catch (err) {
    if (isUserRejected(err)) {
      return { ok: false, error: 'Cancelled in wallet', idempotencyKey, rejected: true };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Signing failed',
      idempotencyKey,
    };
  }

  const body: Record<string, unknown> = {
    taskId: args.taskId,
    [addressField]: args.deps.address,
    signature,
    ...(args.extraBody ?? {}),
  };

  try {
    const res = await fetch(`${args.deps.apiUrl}${args.path}`, {
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        ...(await getLegalRequestHeaders()),
        [IDEMPOTENCY_KEY_HEADER]: idempotencyKey,
      },
      method: 'POST',
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      const error = errBody.message ?? errBody.error ?? `Server error: ${res.status}`;
      if (isPendingWriteResponse(errBody, error)) {
        return { ok: false, pending: true, idempotencyKey, error };
      }
      return { ok: false, error, idempotencyKey };
    }
    const data = (await res.json()) as T & { txHash?: string };
    return { ok: true, data, idempotencyKey, txHash: data.txHash };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Request failed',
      idempotencyKey,
    };
  }
}

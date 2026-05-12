// Helper for the wallet-signed action pattern (no payment).
//
// The signed message is always `taskmarket:<verb>:<taskId>` for task
// actions, matching what the CLI signs in apps/cli/src/commands/task/*.
// The POST body includes the signature plus whatever extra fields the
// caller passes in. The signer address is sent as either workerAddress
// (worker actions) or requesterAddress (requester actions) — pass
// addressField to control that.

import type { useSignMessage } from 'wagmi';

export type WalletSignDeps = {
  address: `0x${string}`;
  apiUrl: string;
  signMessageAsync: ReturnType<typeof useSignMessage>['signMessageAsync'];
};

export type WalletSignResult<T> =
  | { ok: true; data: T; txHash?: string }
  | { ok: false; error: string; rejected?: boolean };

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
}): Promise<WalletSignResult<T>> {
  const addressField = args.addressField ?? 'workerAddress';
  const message = `taskmarket:${args.verbForMessage}:${args.taskId}`;

  let signature: string;
  try {
    signature = await args.deps.signMessageAsync({ message });
  } catch (err) {
    if (isUserRejected(err)) {
      return { ok: false, error: 'Cancelled in wallet', rejected: true };
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Signing failed' };
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
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      return {
        ok: false,
        error: errBody.message ?? errBody.error ?? `Server error: ${res.status}`,
      };
    }
    const data = (await res.json()) as T & { txHash?: string };
    return { ok: true, data, txHash: data.txHash };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Request failed',
    };
  }
}

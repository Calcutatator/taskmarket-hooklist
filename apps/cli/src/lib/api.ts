import { buildLegalReceiptHeaders } from '@taskmarket/shared';

import { loadKeystore, type Keystore } from './keystore.js';

export const API_URL = process.env.TASKMARKET_API_URL ?? 'https://api.taskmarket.dev';
export const API_ORIGIN = new URL(API_URL).origin;

/**
 * Thrown by apiGet/apiPost/apiDelete on a non-2xx response instead of a bare Error, so the
 * real HTTP status is available structurally (`.status`) rather than only embedded as text
 * inside `.message`. Strictly additive -- `ApiError extends Error`, so existing
 * `catch (err: Error)` call sites keep working unchanged. See
 * apps/cli/src/index.ts's top-level catch, which surfaces `.status` on the CLI's standard
 * JSON error envelope when present.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function legalReceiptHeadersForKeystore(
  keystore: Pick<Keystore, 'legalAcceptanceApiOrigin' | 'legalAcceptanceReceipt'>,
  path: string,
  method: 'GET' | 'POST'
): Record<string, string> {
  const canSend =
    keystore.legalAcceptanceApiOrigin === API_ORIGIN &&
    (method === 'POST' || path === '/api/legal/status');
  return canSend ? buildLegalReceiptHeaders(keystore.legalAcceptanceReceipt) : {};
}

async function legalReceiptHeaders(
  path: string,
  method: 'GET' | 'POST'
): Promise<Record<string, string>> {
  try {
    const keystore = await loadKeystore();
    return legalReceiptHeadersForKeystore(keystore, path, method);
  } catch {
    return {};
  }
}

export async function apiGet(
  path: string,
  options?: { headers?: Record<string, string> }
): Promise<unknown> {
  const legalHeaders = await legalReceiptHeaders(path, 'GET');
  const res = await fetch(`${API_URL}${path}`, {
    method: 'GET',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      ...legalHeaders,
      ...(options?.headers ?? {}),
    },
  });
  const body = await res.json();
  if (!res.ok) {
    throw new ApiError(res.status, `GET ${path} failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

export async function apiPost(
  path: string,
  body: Record<string, unknown>,
  options?: { headers?: Record<string, string> }
): Promise<unknown> {
  const legalHeaders = await legalReceiptHeaders(path, 'POST');
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      ...legalHeaders,
      ...(options?.headers ?? {}),
    },
    body: JSON.stringify(body),
  });
  const result = await res.json();
  if (!res.ok) {
    throw new ApiError(
      res.status,
      `POST ${path} failed (${res.status}): ${JSON.stringify(result)}`
    );
  }
  return result;
}

export async function apiDelete(
  path: string,
  options?: { headers?: Record<string, string> }
): Promise<unknown> {
  const legalHeaders = await legalReceiptHeaders(path, 'POST');
  const res = await fetch(`${API_URL}${path}`, {
    method: 'DELETE',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      ...legalHeaders,
      ...(options?.headers ?? {}),
    },
  });
  const result = await res.json();
  if (!res.ok) {
    throw new ApiError(
      res.status,
      `DELETE ${path} failed (${res.status}): ${JSON.stringify(result)}`
    );
  }
  return result;
}

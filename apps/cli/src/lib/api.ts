import { loadKeystore } from './keystore.js';

export const API_URL = process.env.TASKMARKET_API_URL ?? 'https://api.taskmarket.dev';

async function legalReceiptHeaders(): Promise<Record<string, string>> {
  try {
    const keystore = await loadKeystore();
    return keystore.legalAcceptanceReceipt
      ? { 'X-Taskmarket-Legal-Receipt': keystore.legalAcceptanceReceipt }
      : {};
  } catch {
    return {};
  }
}

export async function apiGet(
  path: string,
  options?: { headers?: Record<string, string> }
): Promise<unknown> {
  const legalHeaders = await legalReceiptHeaders();
  const res = await fetch(`${API_URL}${path}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...legalHeaders,
      ...(options?.headers ?? {}),
    },
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`GET ${path} failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

export async function apiPost(path: string, body: Record<string, unknown>): Promise<unknown> {
  const legalHeaders = await legalReceiptHeaders();
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...legalHeaders },
    body: JSON.stringify(body),
  });
  const result = await res.json();
  if (!res.ok) {
    throw new Error(`POST ${path} failed (${res.status}): ${JSON.stringify(result)}`);
  }
  return result;
}

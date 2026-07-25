import { getAccessToken } from '@privy-io/react-auth';
import { LEGAL_RECEIPT_HEADER, buildLegalReceiptHeaders } from '@taskmarket/shared';

const LEGAL_RECEIPT_STORAGE_KEY = 'taskmarket:legal-receipt';
const LEGAL_BUNDLE_STORAGE_KEY = 'taskmarket:legal-bundle-version';

export function getLegalReceipt(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.localStorage.getItem(LEGAL_RECEIPT_STORAGE_KEY) ?? undefined;
}

export function setLegalReceipt(receipt: string, bundleVersion: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LEGAL_RECEIPT_STORAGE_KEY, receipt);
  window.localStorage.setItem(LEGAL_BUNDLE_STORAGE_KEY, bundleVersion);
}

export function clearLegalReceipt(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LEGAL_RECEIPT_STORAGE_KEY);
    window.localStorage.removeItem(LEGAL_BUNDLE_STORAGE_KEY);
  } catch {
    // Logout must continue when browser storage is unavailable.
  }
}

export function getLegalReceiptHeaders(): Record<string, string> {
  return buildLegalReceiptHeaders(getLegalReceipt());
}

export async function getLegalRequestHeaders(): Promise<Record<string, string>> {
  const headers = getLegalReceiptHeaders();
  if (!headers[LEGAL_RECEIPT_HEADER]) return headers;
  try {
    const accessToken = await getAccessToken();
    return accessToken ? { ...headers, Authorization: `Bearer ${accessToken}` } : headers;
  } catch {
    return headers;
  }
}

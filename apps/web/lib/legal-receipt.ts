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
  window.localStorage.removeItem(LEGAL_RECEIPT_STORAGE_KEY);
  window.localStorage.removeItem(LEGAL_BUNDLE_STORAGE_KEY);
}

export function getLegalReceiptHeaders(): Record<string, string> {
  const receipt = getLegalReceipt();
  return receipt ? { 'X-Taskmarket-Legal-Receipt': receipt } : {};
}

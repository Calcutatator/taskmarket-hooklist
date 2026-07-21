import { buildLegalReceiptHeaders } from '@taskmarket/shared';

import { API_URL } from './api.js';

export type DeviceRegistration = {
  agentId: string | null;
  apiToken: string;
  deviceEncryptionKey: string;
  deviceId: string;
};

export async function registerDevice(input: {
  legalReceipt?: string;
  publicKey: string;
  signature: string;
  walletAddress: string;
}): Promise<DeviceRegistration> {
  const response = await fetch(`${API_URL}/api/devices`, {
    body: JSON.stringify({
      publicKey: input.publicKey,
      signature: input.signature,
      walletAddress: input.walletAddress,
    }),
    headers: {
      'Content-Type': 'application/json',
      ...buildLegalReceiptHeaders(input.legalReceipt),
    },
    method: 'POST',
    redirect: 'error',
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Device registration failed (${response.status}): ${text}`);
  }

  return (await response.json()) as DeviceRegistration;
}

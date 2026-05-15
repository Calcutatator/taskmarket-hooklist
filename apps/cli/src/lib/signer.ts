import { privateKeyToAccount } from 'viem/accounts';
import { toHex } from 'viem';
import { loadKeystore, decryptPrivateKey, type Keystore } from './keystore.js';
const MAINNET_API_URL = 'https://api-market.daydreams.systems';

export interface TypedData {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  primaryType: string;
  message: Record<string, unknown>;
}

export async function fetchDeviceKey(
  deviceId: string,
  apiToken: string,
  keyServerUrl?: string
): Promise<string> {
  // Old keystores lack keyServerUrl — fall back to mainnet where all existing
  // devices were registered. New keystores have it stamped at init/import time.
  const base = keyServerUrl ?? MAINNET_API_URL;
  const res = await fetch(`${base}/api/devices/${deviceId}/key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, apiToken }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to fetch device key (${res.status}): ${text}`);
  }
  const data = (await res.json()) as { deviceEncryptionKey: string };
  return data.deviceEncryptionKey;
}

export async function signTypedData(typedData: TypedData, keystore: Keystore): Promise<string> {
  const account = await createWalletAccountFromKeystore(keystore);
  const sig = await account.signTypedData(typedData as Parameters<typeof account.signTypedData>[0]);
  return sig;
}

export async function signMessage(message: string, keystore: Keystore): Promise<string> {
  const account = await createWalletAccountFromKeystore(keystore);
  const sig = await account.signMessage({ message });
  return sig;
}

export async function createWalletAccountFromKeystore(keystore: Keystore) {
  const dek = await fetchDeviceKey(keystore.deviceId, keystore.apiToken, keystore.keyServerUrl);
  const privateKey = decryptPrivateKey(dek, keystore.encryptedKey);
  return privateKeyToAccount(privateKey as `0x${string}`);
}

export function createSignFn(keystore: Keystore): (typedData: TypedData) => Promise<string> {
  return (typedData) => signTypedData(typedData, keystore);
}

export async function getWalletAddress(): Promise<string> {
  const keystore = await loadKeystore();
  return keystore.walletAddress;
}

export async function createTransferAuthorization(
  accept: {
    payTo: string;
    amount: string;
    maxTimeoutSeconds: number;
    extra: {
      eip712: {
        domain: Record<string, unknown>;
        types: Record<string, unknown>;
        primaryType: string;
      };
    };
  },
  keystore: Keystore
): Promise<{ authorization: Record<string, string>; signature: string }> {
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: keystore.walletAddress,
    to: accept.payTo,
    value: accept.amount,
    validAfter: String(now - 60),
    validBefore: String(now + accept.maxTimeoutSeconds),
    nonce: toHex(crypto.getRandomValues(new Uint8Array(32))),
  };
  const signature = await signTypedData(
    {
      domain: accept.extra.eip712.domain,
      types: accept.extra.eip712.types,
      primaryType: accept.extra.eip712.primaryType,
      message: authorization,
    },
    keystore
  );
  return { authorization, signature };
}

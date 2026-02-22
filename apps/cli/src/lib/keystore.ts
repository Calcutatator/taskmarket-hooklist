import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { privateKeyToAccount } from 'viem/accounts';

export interface Keystore {
  encryptedKey: string;
  walletAddress: string;
  deviceId: string;
  apiToken: string;
}

export function getKeystorePath(): string {
  return path.join(os.homedir(), '.taskmarket', 'keystore.json');
}

export function generateKeypair(): { privateKey: string; address: string } {
  const keyBytes = randomBytes(32);
  const privateKey = ('0x' + keyBytes.toString('hex')) as `0x${string}`;
  const account = privateKeyToAccount(privateKey);
  return { privateKey, address: account.address };
}

export function encryptPrivateKey(deviceEncryptionKeyHex: string, privateKey: string): string {
  const key = Buffer.from(deviceEncryptionKeyHex, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(privateKey, 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Layout: iv (12 bytes) | tag (16 bytes) | ciphertext
  return Buffer.concat([iv, tag, encrypted]).toString('hex');
}

export function decryptPrivateKey(deviceEncryptionKeyHex: string, encryptedHex: string): string {
  const key = Buffer.from(deviceEncryptionKeyHex, 'hex');
  const data = Buffer.from(encryptedHex, 'hex');
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const ciphertext = data.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

export async function saveKeystore(keystore: Keystore, keystorePath?: string): Promise<void> {
  const p = keystorePath ?? getKeystorePath();
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(keystore, null, 2), 'utf8');
}

export async function loadKeystore(keystorePath?: string): Promise<Keystore> {
  const p = keystorePath ?? getKeystorePath();
  let data: string;
  try {
    data = await fs.readFile(p, 'utf8');
  } catch {
    throw new Error(`Keystore not found at ${p}. Run 'taskmarket init' first.`);
  }
  return JSON.parse(data) as Keystore;
}

export async function keystoreExists(keystorePath?: string): Promise<boolean> {
  const p = keystorePath ?? getKeystorePath();
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

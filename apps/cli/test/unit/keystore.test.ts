import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  generateKeypair,
  encryptPrivateKey,
  decryptPrivateKey,
  saveKeystore,
  loadKeystore,
  keystoreExists,
  type Keystore,
} from '../../src/lib/keystore.js';

function randomDek(): string {
  return randomBytes(32).toString('hex');
}

describe('generateKeypair', () => {
  it('returns a 0x-prefixed hex private key', () => {
    const { privateKey } = generateKeypair();
    expect(privateKey).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('returns a valid Ethereum address', () => {
    const { address } = generateKeypair();
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('generates unique keypairs on each call', () => {
    const { privateKey: k1 } = generateKeypair();
    const { privateKey: k2 } = generateKeypair();
    expect(k1).not.toBe(k2);
  });
});

describe('encryptPrivateKey / decryptPrivateKey', () => {
  it('round-trips correctly', () => {
    const dek = randomDek();
    const { privateKey } = generateKeypair();
    const encrypted = encryptPrivateKey(dek, privateKey);
    const decrypted = decryptPrivateKey(dek, encrypted);
    expect(decrypted).toBe(privateKey);
  });

  it('produces different ciphertext on each call (random IV)', () => {
    const dek = randomDek();
    const { privateKey } = generateKeypair();
    const enc1 = encryptPrivateKey(dek, privateKey);
    const enc2 = encryptPrivateKey(dek, privateKey);
    expect(enc1).not.toBe(enc2);
  });

  it('encrypted blob does not contain plaintext private key', () => {
    const dek = randomDek();
    const { privateKey } = generateKeypair();
    const encrypted = encryptPrivateKey(dek, privateKey);
    // Strip the 0x prefix for substring check
    expect(encrypted).not.toContain(privateKey.slice(2));
  });

  it('throws on wrong DEK', () => {
    const dek = randomDek();
    const wrongDek = randomDek();
    const { privateKey } = generateKeypair();
    const encrypted = encryptPrivateKey(dek, privateKey);
    expect(() => decryptPrivateKey(wrongDek, encrypted)).toThrow();
  });

  it('throws on tampered ciphertext', () => {
    const dek = randomDek();
    const { privateKey } = generateKeypair();
    const encrypted = encryptPrivateKey(dek, privateKey);
    // Flip a byte in the ciphertext portion (after iv + tag = 56 hex chars)
    const tampered = encrypted.slice(0, 56) + (encrypted[56] === 'a' ? 'b' : 'a') + encrypted.slice(57);
    expect(() => decryptPrivateKey(dek, tampered)).toThrow();
  });
});

describe('saveKeystore / loadKeystore', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'keystore-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function tmpKeystorePath(): string {
    return path.join(tmpDir, 'keystore.json');
  }

  it('writes keystore to expected path and loads it back', async () => {
    const dek = randomDek();
    const { privateKey, address } = generateKeypair();
    const keystore: Keystore = {
      encryptedKey: encryptPrivateKey(dek, privateKey),
      walletAddress: address,
      deviceId: 'test-device-id',
      apiToken: 'test-api-token',
    };

    const p = tmpKeystorePath();
    await saveKeystore(keystore, p);
    const loaded = await loadKeystore(p);

    expect(loaded.walletAddress).toBe(address);
    expect(loaded.deviceId).toBe('test-device-id');
    expect(loaded.apiToken).toBe('test-api-token');
    expect(loaded.encryptedKey).toBe(keystore.encryptedKey);
  });

  it('creates parent directories if they do not exist', async () => {
    const nestedPath = path.join(tmpDir, 'nested', 'deep', 'keystore.json');
    const { privateKey, address } = generateKeypair();
    const keystore: Keystore = {
      encryptedKey: encryptPrivateKey(randomDek(), privateKey),
      walletAddress: address,
      deviceId: 'x',
      apiToken: 'y',
    };
    await saveKeystore(keystore, nestedPath);
    const loaded = await loadKeystore(nestedPath);
    expect(loaded.walletAddress).toBe(address);
  });

  it('throws if keystore does not exist', async () => {
    const missingPath = path.join(tmpDir, 'missing.json');
    await expect(loadKeystore(missingPath)).rejects.toThrow();
  });

  it('keystoreExists returns false when file is absent', async () => {
    const missingPath = path.join(tmpDir, 'missing.json');
    expect(await keystoreExists(missingPath)).toBe(false);
  });

  it('keystoreExists returns true after save', async () => {
    const p = tmpKeystorePath();
    const { privateKey, address } = generateKeypair();
    await saveKeystore(
      { encryptedKey: encryptPrivateKey(randomDek(), privateKey), walletAddress: address, deviceId: 'x', apiToken: 'y' },
      p
    );
    expect(await keystoreExists(p)).toBe(true);
  });
});

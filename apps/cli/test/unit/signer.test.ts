import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomBytes } from 'crypto';
import { generateKeypair, encryptPrivateKey, type Keystore } from '../../src/lib/keystore.js';
import { fetchDeviceKey, signTypedData, signMessage } from '../../src/lib/signer.js';

// Mock fetch globally before any test runs
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function randomDek(): string {
  return randomBytes(32).toString('hex');
}

function makeKeystore(dek: string, privateKey: string, address: string): Keystore {
  return {
    encryptedKey: encryptPrivateKey(dek, privateKey),
    walletAddress: address,
    deviceId: 'test-device-id',
    apiToken: 'test-api-token',
  };
}

const SAMPLE_TYPED_DATA = {
  domain: {
    name: 'USDC',
    version: '2',
    chainId: 84532,
    verifyingContract: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  },
  types: {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  },
  primaryType: 'TransferWithAuthorization',
  message: {
    from: '0x0000000000000000000000000000000000000001',
    to: '0x0000000000000000000000000000000000000002',
    value: '1000',
    validAfter: '0',
    validBefore: '9999999999',
    nonce: '0x' + '00'.repeat(32),
  },
};

describe('fetchDeviceKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns deviceEncryptionKey on 200', async () => {
    const dek = randomDek();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ deviceEncryptionKey: dek }),
    });

    const result = await fetchDeviceKey('test-id', 'test-token');
    expect(result).toBe(dek);
  });

  it('throws on non-200 response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    await expect(fetchDeviceKey('test-id', 'bad-token')).rejects.toThrow('401');
  });
});

describe('signTypedData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches DEK, decrypts key, and returns a signature', async () => {
    const dek = randomDek();
    const { privateKey, address } = generateKeypair();
    const keystore = makeKeystore(dek, privateKey, address);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ deviceEncryptionKey: dek }),
    });

    const sig = await signTypedData(SAMPLE_TYPED_DATA, keystore);

    expect(typeof sig).toBe('string');
    expect(sig).toMatch(/^0x[0-9a-f]+$/i);
  });

  it('does not expose private key in thrown error', async () => {
    const dek = randomDek();
    const { privateKey, address } = generateKeypair();
    const keystore = makeKeystore(dek, privateKey, address);

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    });

    let caughtError: Error | undefined;
    try {
      await signTypedData(SAMPLE_TYPED_DATA, keystore);
    } catch (err) {
      caughtError = err as Error;
    }

    expect(caughtError).toBeDefined();
    expect(caughtError!.message).not.toContain(privateKey.slice(2));
  });
});

describe('signMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('signs a message and returns a valid hex signature', async () => {
    const dek = randomDek();
    const { privateKey, address } = generateKeypair();
    const keystore = makeKeystore(dek, privateKey, address);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ deviceEncryptionKey: dek }),
    });

    const sig = await signMessage('0xdeadbeef', keystore);

    expect(typeof sig).toBe('string');
    expect(sig).toMatch(/^0x[0-9a-f]+$/i);
  });
});

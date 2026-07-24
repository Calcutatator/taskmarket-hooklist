import { describe, it, expect } from 'vitest';
import { generateKeypair } from '../../src/lib/keystore.js';
import {
  derivePublicKey,
  deriveCompressedPublicKey,
  encryptForRecipient,
  decryptWithPrivateKey,
} from '../../src/lib/encryption.js';

describe('derivePublicKey / deriveCompressedPublicKey', () => {
  it('derives a 65-byte uncompressed key starting with 0x04', () => {
    const { privateKey } = generateKeypair();
    const pub = derivePublicKey(privateKey);
    expect(pub).toMatch(/^04[0-9a-f]{128}$/);
    expect(Buffer.from(pub, 'hex').length).toBe(65);
  });

  it('derives a 33-byte compressed key with a 02/03 prefix', () => {
    const { privateKey } = generateKeypair();
    const pub = deriveCompressedPublicKey(privateKey);
    expect(pub).toMatch(/^0[23][0-9a-f]{64}$/);
    expect(Buffer.from(pub, 'hex').length).toBe(33);
  });

  it('is deterministic for a given private key', () => {
    const { privateKey } = generateKeypair();
    expect(derivePublicKey(privateKey)).toBe(derivePublicKey(privateKey));
  });

  it('accepts a private key without the 0x prefix', () => {
    const { privateKey } = generateKeypair();
    expect(derivePublicKey(privateKey.replace(/^0x/, ''))).toBe(derivePublicKey(privateKey));
  });
});

describe('encryptForRecipient / decryptWithPrivateKey', () => {
  it('round-trips a payload for an uncompressed recipient key', () => {
    const { privateKey } = generateKeypair();
    const pub = derivePublicKey(privateKey);
    const plaintext = Buffer.from('the quick brown fox', 'utf8');

    const encrypted = encryptForRecipient(plaintext, pub);
    const decrypted = decryptWithPrivateKey(encrypted, privateKey);

    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it('round-trips a payload for a compressed recipient key', () => {
    const { privateKey } = generateKeypair();
    const pub = deriveCompressedPublicKey(privateKey);
    const plaintext = Buffer.from('compressed recipient key', 'utf8');

    const decrypted = decryptWithPrivateKey(encryptForRecipient(plaintext, pub), privateKey);

    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it('round-trips a single-byte payload', () => {
    const { privateKey } = generateKeypair();
    const pub = derivePublicKey(privateKey);
    const decrypted = decryptWithPrivateKey(
      encryptForRecipient(Buffer.from([0x00]), pub),
      privateKey
    );
    expect(decrypted.equals(Buffer.from([0x00]))).toBe(true);
  });

  it('rejects a header-only blob with no ciphertext (requires >= 1 ciphertext byte)', () => {
    const { privateKey } = generateKeypair();
    const pub = derivePublicKey(privateKey);
    // An empty payload yields exactly the 94-byte header, which the length guard rejects.
    const headerOnly = encryptForRecipient(Buffer.alloc(0), pub);
    expect(headerOnly.length).toBe(94);
    expect(() => decryptWithPrivateKey(headerOnly, privateKey)).toThrow(
      'Decryption failed: invalid key or corrupted file'
    );
  });

  it('produces a header of the documented length plus ciphertext', () => {
    const { privateKey } = generateKeypair();
    const pub = derivePublicKey(privateKey);
    const plaintext = Buffer.from('abcd', 'utf8');
    const encrypted = encryptForRecipient(plaintext, pub);
    // version(1) + ephPubKey(65) + iv(12) + tag(16) = 94-byte header
    expect(encrypted[0]).toBe(0x01);
    expect(encrypted.length).toBe(94 + plaintext.length);
  });

  it('produces different ciphertext each call (ephemeral key + random IV)', () => {
    const { privateKey } = generateKeypair();
    const pub = derivePublicKey(privateKey);
    const plaintext = Buffer.from('same message', 'utf8');
    const a = encryptForRecipient(plaintext, pub);
    const b = encryptForRecipient(plaintext, pub);
    expect(a.equals(b)).toBe(false);
  });

  it('does not leak the plaintext into the ciphertext blob', () => {
    const { privateKey } = generateKeypair();
    const pub = derivePublicKey(privateKey);
    const secret = 'super-secret-value';
    const encrypted = encryptForRecipient(Buffer.from(secret, 'utf8'), pub);
    expect(encrypted.toString('utf8')).not.toContain(secret);
  });

  it('throws when decrypting with the wrong private key', () => {
    const recipient = generateKeypair();
    const attacker = generateKeypair();
    const pub = derivePublicKey(recipient.privateKey);
    const encrypted = encryptForRecipient(Buffer.from('secret', 'utf8'), pub);

    expect(() => decryptWithPrivateKey(encrypted, attacker.privateKey)).toThrow(
      'Decryption failed: invalid key or corrupted file'
    );
  });

  it('throws when the ciphertext is tampered with', () => {
    const { privateKey } = generateKeypair();
    const pub = derivePublicKey(privateKey);
    const encrypted = encryptForRecipient(Buffer.from('secret payload', 'utf8'), pub);
    encrypted[encrypted.length - 1] ^= 0xff;

    expect(() => decryptWithPrivateKey(encrypted, privateKey)).toThrow(
      'Decryption failed: invalid key or corrupted file'
    );
  });

  it('throws on a buffer shorter than the header', () => {
    const { privateKey } = generateKeypair();
    expect(() => decryptWithPrivateKey(Buffer.alloc(10), privateKey)).toThrow(
      'Decryption failed: invalid key or corrupted file'
    );
  });

  it('throws on an unsupported version byte', () => {
    const { privateKey } = generateKeypair();
    const pub = derivePublicKey(privateKey);
    const encrypted = encryptForRecipient(Buffer.from('secret', 'utf8'), pub);
    encrypted[0] = 0x02;

    expect(() => decryptWithPrivateKey(encrypted, privateKey)).toThrow(
      'unsupported file version 0x2'
    );
  });
});

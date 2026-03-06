import { createECDH, hkdfSync, createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// File format (binary):
//   version   (1 byte)  — 0x01
//   ephPubKey (65 bytes) — uncompressed secp256k1 point
//   iv        (12 bytes)
//   tag       (16 bytes)
//   ciphertext (N bytes)

const VERSION = 0x01;
const EPH_PUB_LEN = 65;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = 1 + EPH_PUB_LEN + IV_LEN + TAG_LEN; // 94

function ecdhSharedSecret(privateKeyHex: string, otherPubKeyHex: string): Buffer {
  const ecdh = createECDH('secp256k1');
  ecdh.setPrivateKey(Buffer.from(privateKeyHex.replace(/^0x/, ''), 'hex'));
  const shared = ecdh.computeSecret(Buffer.from(otherPubKeyHex, 'hex'));
  return shared;
}

function hkdfKey(sharedSecret: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', sharedSecret, Buffer.alloc(0), 'taskmarket-ecies-v1', 32));
}

function aesGcmEncrypt(
  key: Buffer,
  iv: Buffer,
  plaintext: Buffer
): { ciphertext: Buffer; tag: Buffer } {
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext, tag };
}

function aesGcmDecrypt(key: Buffer, iv: Buffer, tag: Buffer, ciphertext: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Derive the uncompressed secp256k1 public key (65-byte hex) from a private key.
 */
export function derivePublicKey(privateKeyHex: string): string {
  const ecdh = createECDH('secp256k1');
  ecdh.setPrivateKey(Buffer.from(privateKeyHex.replace(/^0x/, ''), 'hex'));
  return ecdh.getPublicKey(undefined, 'uncompressed').toString('hex');
}

/**
 * Derive the compressed secp256k1 public key (33-byte hex) from a private key.
 * Used when publishing the key to the backend.
 */
export function deriveCompressedPublicKey(privateKeyHex: string): string {
  const ecdh = createECDH('secp256k1');
  ecdh.setPrivateKey(Buffer.from(privateKeyHex.replace(/^0x/, ''), 'hex'));
  return ecdh.getPublicKey(undefined, 'compressed').toString('hex');
}

/**
 * Encrypt `fileBuffer` so only the holder of `recipientPubKeyHex` can decrypt.
 * `recipientPubKeyHex` may be 33-byte compressed or 65-byte uncompressed.
 */
export function encryptForRecipient(fileBuffer: Buffer, recipientPubKeyHex: string): Buffer {
  // Generate ephemeral keypair
  const ephEcdh = createECDH('secp256k1');
  ephEcdh.generateKeys();
  const ephPubKey = ephEcdh.getPublicKey(undefined, 'uncompressed'); // 65 bytes
  const ephPrivKeyHex = ephEcdh.getPrivateKey('hex');

  // ECDH shared secret
  const shared = ecdhSharedSecret(ephPrivKeyHex, recipientPubKeyHex);
  const aesKey = hkdfKey(shared);

  const iv = randomBytes(IV_LEN);
  const { ciphertext, tag } = aesGcmEncrypt(aesKey, iv, fileBuffer);

  // version | ephPubKey | iv | tag | ciphertext
  return Buffer.concat([Buffer.from([VERSION]), ephPubKey, iv, tag, ciphertext]);
}

/**
 * Decrypt a buffer that was encrypted with `encryptForRecipient`.
 * Throws if the key is wrong or the file is corrupted.
 */
export function decryptWithPrivateKey(fileBuffer: Buffer, privateKeyHex: string): Buffer {
  if (fileBuffer.length < HEADER_LEN + 1) {
    throw new Error('Decryption failed: invalid key or corrupted file');
  }

  const version = fileBuffer[0];
  if (version !== VERSION) {
    throw new Error(`Decryption failed: unsupported file version 0x${version.toString(16)}`);
  }

  const ephPubKeyHex = fileBuffer.subarray(1, 1 + EPH_PUB_LEN).toString('hex');
  const iv = fileBuffer.subarray(1 + EPH_PUB_LEN, 1 + EPH_PUB_LEN + IV_LEN);
  const tag = fileBuffer.subarray(1 + EPH_PUB_LEN + IV_LEN, 1 + EPH_PUB_LEN + IV_LEN + TAG_LEN);
  const ciphertext = fileBuffer.subarray(1 + EPH_PUB_LEN + IV_LEN + TAG_LEN);

  const shared = ecdhSharedSecret(privateKeyHex, ephPubKeyHex);
  const aesKey = hkdfKey(shared);

  try {
    return aesGcmDecrypt(aesKey, iv, tag, ciphertext);
  } catch {
    throw new Error('Decryption failed: invalid key or corrupted file');
  }
}

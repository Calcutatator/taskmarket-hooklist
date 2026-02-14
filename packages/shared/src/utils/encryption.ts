import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  publicEncrypt,
  privateDecrypt,
  constants,
} from 'crypto';

export class Encryptor {
  /**
   * Encrypts a file for a specific recipient's public key
   * @param fileBuffer - File content to encrypt
   * @param recipientPublicKey - RSA public key in PEM format (base64, without headers)
   * @returns Object with encrypted file buffer and encrypted AES key (base64)
   */
  static async encryptFile(
    fileBuffer: Buffer,
    recipientPublicKey: string
  ): Promise<{ encryptedFile: Buffer; encryptedKey: string }> {
    // Generate random AES-256 key and IV
    const symmetricKey = randomBytes(32);
    const iv = randomBytes(16);

    // Encrypt file with AES-256-CBC
    const cipher = createCipheriv('aes-256-cbc', symmetricKey, iv);
    const encryptedFile = Buffer.concat([
      iv, // Prepend IV to ciphertext
      cipher.update(fileBuffer),
      cipher.final(),
    ]);

    // Encrypt symmetric key with recipient's RSA public key
    const publicKey = `-----BEGIN PUBLIC KEY-----\n${recipientPublicKey}\n-----END PUBLIC KEY-----`;
    const encryptedKey = publicEncrypt(
      {
        key: publicKey,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      symmetricKey
    );

    return {
      encryptedFile,
      encryptedKey: encryptedKey.toString('base64'),
    };
  }

  /**
   * Decrypts a file using private key
   * @param encryptedFile - Encrypted file buffer (IV + ciphertext)
   * @param encryptedKey - Encrypted AES key (base64)
   * @param privateKey - RSA private key in PEM format (base64, without headers)
   * @returns Decrypted file buffer
   */
  static async decryptFile(
    encryptedFile: Buffer,
    encryptedKey: string,
    privateKey: string
  ): Promise<Buffer> {
    // Decrypt symmetric key with private key
    const privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;
    const symmetricKey = privateDecrypt(
      {
        key: privateKeyPem,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from(encryptedKey, 'base64')
    );

    // Extract IV and decrypt file
    const iv = encryptedFile.slice(0, 16);
    const encrypted = encryptedFile.slice(16);

    const decipher = createDecipheriv('aes-256-cbc', symmetricKey, iv);
    const decryptedFile = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    return decryptedFile;
  }
}

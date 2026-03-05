import { Command } from 'commander';
import { promises as fs } from 'fs';
import { loadKeystore, decryptPrivateKey } from '../lib/keystore.js';
import { fetchDeviceKey } from '../lib/signer.js';
import { encryptForRecipient, derivePublicKey } from '../lib/encryption.js';
import { apiGet } from '../lib/api.js';
import { printResult, printError } from '../lib/output.js';

export const encryptCommand = new Command('encrypt')
  .description('Encrypt a file with ECIES using wallet keys')
  .argument('<file>', 'Path to the file to encrypt')
  .option('--recipient <address>', 'Recipient wallet address (default: self)')
  .option('--output <path>', 'Output path (default: <file>.enc)')
  .action(async (file: string, opts: { recipient?: string; output?: string }) => {
    // Read input file
    let plaintext: Buffer;
    try {
      plaintext = await fs.readFile(file);
    } catch {
      printError(`Cannot read file: ${file}`);
    }

    // Load keystore to get own keys
    let keystore: Awaited<ReturnType<typeof loadKeystore>>;
    try {
      keystore = await loadKeystore();
    } catch {
      printError('No keystore found. Run `taskmarket init` first.');
    }

    let recipientPubKey: string;
    let recipientAddress: string;

    if (opts.recipient) {
      recipientAddress = opts.recipient;
      // Fetch recipient's public key from backend
      let result: { result: { data: { publicKey: string } } };
      try {
        result = (await apiGet(
          `/trpc/agents.publicKey?input=${encodeURIComponent(JSON.stringify({ address: opts.recipient }))}`
        )) as typeof result;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // Surface the backend NOT_FOUND message if present
        if (msg.includes('publish their public key') || msg.includes('NOT_FOUND')) {
          printError(
            `Recipient has not published their public key. Ask them to run: taskmarket wallet publish-key`
          );
        }
        printError(`Failed to fetch recipient public key: ${msg}`);
      }
      recipientPubKey = result!.result.data.publicKey;
    } else {
      // Self-encryption: use own public key
      recipientAddress = keystore.walletAddress;
      const dek = await fetchDeviceKey(keystore.deviceId, keystore.apiToken);
      const privateKey = decryptPrivateKey(dek, keystore.encryptedKey);
      recipientPubKey = derivePublicKey(privateKey);
    }

    const encrypted = encryptForRecipient(plaintext, recipientPubKey);

    const outputPath = opts.output ?? `${file}.enc`;
    await fs.writeFile(outputPath, encrypted);

    printResult({
      output: outputPath,
      bytes: encrypted.length,
      recipient: recipientAddress,
    });
  });

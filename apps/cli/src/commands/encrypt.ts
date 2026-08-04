import { Command } from 'commander';
import { promises as fs } from 'fs';
import { loadKeystore, decryptPrivateKey } from '../lib/keystore.js';
import { fetchDeviceKey } from '../lib/signer.js';
import { encryptForRecipient, derivePublicKey } from '../lib/encryption.js';
import { apiGet, withErrorContext } from '../lib/api.js';
import { printResult, printError, renderFailure } from '../lib/output.js';

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
      return;
    }

    // Load keystore to get own keys
    let keystore: Awaited<ReturnType<typeof loadKeystore>>;
    try {
      keystore = await loadKeystore();
    } catch {
      printError('No keystore found. Run `taskmarket init` first.');
      return;
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
        // A missing public key is the one failure here with an action attached, so it is said
        // plainly. The test is still on prose because `agents.publicKey` is a read rather than a
        // relayed write, and ADR-0058 leaves reads `unclassified` -- there is no reason code to
        // branch on yet. What changed is that the nicer sentence is now a prefix on the real
        // error rather than a replacement for it, so the status and any envelope that did arrive
        // still reach the caller.
        const context =
          msg.includes('publish their public key') || msg.includes('NOT_FOUND')
            ? 'Recipient has not published their public key. Ask them to run: taskmarket wallet publish-key'
            : 'Failed to fetch recipient public key';
        renderFailure(withErrorContext(err, context));
        return;
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

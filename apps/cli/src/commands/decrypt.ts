import { Command } from 'commander';
import { promises as fs } from 'fs';
import { loadKeystore, decryptPrivateKey } from '../lib/keystore.js';
import { fetchDeviceKey } from '../lib/signer.js';
import { decryptWithPrivateKey } from '../lib/encryption.js';
import { printResult, printError, renderFailure } from '../lib/output.js';

export const decryptCommand = new Command('decrypt')
  .description('Decrypt a file using your wallet key')
  .argument('<file>', 'Path to the encrypted file')
  .option('--output <path>', 'Output path (default: strips .enc, otherwise appends .dec)')
  .action(async (file: string, opts: { output?: string }) => {
    // Read encrypted file
    let ciphertext: Buffer;
    try {
      ciphertext = await fs.readFile(file);
    } catch {
      printError(`Cannot read file: ${file}`);
    }

    // Load keystore
    let keystore: Awaited<ReturnType<typeof loadKeystore>>;
    try {
      keystore = await loadKeystore();
    } catch {
      printError('No keystore found. Run `taskmarket init` first.');
    }

    // Decrypt private key from keystore
    const dek = await fetchDeviceKey(keystore.deviceId, keystore.apiToken);
    const privateKey = decryptPrivateKey(dek, keystore.encryptedKey);

    let plaintext: Buffer;
    try {
      plaintext = decryptWithPrivateKey(ciphertext, privateKey);
    } catch (err: unknown) {
      renderFailure(err);
    }

    // Determine output path
    let outputPath: string;
    if (opts.output) {
      outputPath = opts.output;
    } else if (file.endsWith('.enc')) {
      outputPath = file.slice(0, -4);
    } else {
      outputPath = `${file}.dec`;
    }

    await fs.writeFile(outputPath, plaintext!);

    printResult({
      output: outputPath,
      bytes: plaintext!.length,
    });
  });

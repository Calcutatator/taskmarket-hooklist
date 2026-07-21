import { Command } from 'commander';
import { LegalBundleSchema, buildDeviceRegisterMessage } from '@taskmarket/shared';
import { createInterface } from 'readline';
import { privateKeyToAccount } from 'viem/accounts';
import {
  encryptPrivateKey,
  saveKeystore,
  keystoreExists,
  loadKeystore,
} from '../../lib/keystore.js';
import { API_ORIGIN, API_URL, apiGet } from '../../lib/api.js';
import { registerDevice } from '../../lib/device-registration.js';
import { printResult } from '../../lib/output.js';
import { pollAgentId } from '../../lib/agent.js';
import { deriveCompressedPublicKey } from '../../lib/encryption.js';
import { acceptLegalBundle } from '../legal/index.js';

function normalizePrivateKey(raw: string): `0x${string}` {
  const hex = raw.startsWith('0x') ? raw.slice(2) : raw;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('Invalid private key: must be 32 bytes (64 hex characters)');
  }
  return `0x${hex}` as `0x${string}`;
}

function promptHiddenInput(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    process.stdout.write(prompt);

    // Suppress echo
    const muted = { muted: false };
    const _write = (rl as unknown as { output: { write: (s: string) => void } }).output.write.bind(
      (rl as unknown as { output: { write: (s: string) => void } }).output
    );
    (rl as unknown as { output: { write: (s: string) => void } }).output.write = (s: string) => {
      if (muted.muted) return;
      _write(s);
    };
    muted.muted = true;

    rl.question('', (answer) => {
      muted.muted = false;
      process.stdout.write('\n');
      rl.close();
      resolve(answer);
    });
  });
}

export const walletImportCommand = new Command('import')
  .description('Import an existing private key as the agent wallet')
  .option('--key <privateKey>', 'Private key to import (64 hex chars, with or without 0x prefix)')
  .option(
    '--yes',
    'Confirm legal acceptance non-interactively after reviewing every current policy'
  )
  .action(async (opts: { key?: string; yes?: boolean }) => {
    if (await keystoreExists()) {
      const keystore = await loadKeystore();
      printResult({ address: keystore.walletAddress, agentId: keystore.agentId });
      return;
    }

    // Determine key source: --key flag, env var, or interactive prompt
    let rawKey: string;
    let keySource: 'flag' | 'env' | 'prompt';

    if (opts.key) {
      rawKey = opts.key;
      keySource = 'flag';
    } else if (process.env['TASKMARKET_IMPORT_KEY']) {
      rawKey = process.env['TASKMARKET_IMPORT_KEY'];
      keySource = 'env';
    } else {
      rawKey = await promptHiddenInput('Enter private key (input hidden): ');
      keySource = 'prompt';
    }

    const privateKey = normalizePrivateKey(rawKey);
    const account = privateKeyToAccount(privateKey);
    const address = account.address;
    const publicKey = deriveCompressedPublicKey(privateKey);
    const legalBundle = LegalBundleSchema.parse(await apiGet('/api/legal/current'));
    const legalAcceptance = legalBundle.enforcementEnabled
      ? await acceptLegalBundle({
          assumeYes: Boolean(opts.yes),
          bundle: legalBundle,
          signMessage: (message) => account.signMessage({ message }),
          walletAddress: address,
        })
      : undefined;

    const deviceRegisterSignature = await account.signMessage({
      message: buildDeviceRegisterMessage(address),
    });

    const {
      deviceId,
      apiToken,
      deviceEncryptionKey,
      agentId: initialAgentId,
    } = await registerDevice({
      legalReceipt: legalAcceptance?.receipt,
      publicKey,
      signature: deviceRegisterSignature,
      walletAddress: address,
    });

    const encryptedKey = encryptPrivateKey(deviceEncryptionKey, privateKey);

    // agentId may be null if on-chain registration is still pending — poll for it
    let agentId: string | null = initialAgentId;
    await saveKeystore({
      encryptedKey,
      walletAddress: address,
      deviceId,
      apiToken,
      agentId,
      keyServerUrl: API_URL,
      ...(legalAcceptance
        ? {
            legalAcceptanceApiOrigin: API_ORIGIN,
            legalAcceptanceBundleVersion: legalAcceptance.bundleVersion,
            legalAcceptanceReceipt: legalAcceptance.receipt,
          }
        : {}),
    });

    if (!agentId) {
      agentId = await pollAgentId(address);
      if (agentId) {
        const keystore = await loadKeystore();
        await saveKeystore({ ...keystore, agentId });
      }
    }

    if (keySource === 'flag') {
      process.stderr.write(
        JSON.stringify({
          warning:
            'Private key was passed via --key flag and may be visible in shell history and ps aux.',
        }) + '\n'
      );
    }
    printResult({ address, agentId });
  });

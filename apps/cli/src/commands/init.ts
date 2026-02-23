import { Command } from 'commander';
import {
  generateKeypair,
  encryptPrivateKey,
  saveKeystore,
  keystoreExists,
  getKeystorePath,
  loadKeystore,
} from '../lib/keystore.js';
import { API_URL } from '../lib/api.js';
import { isHumanMode, printResult } from '../lib/output.js';

export const initCommand = new Command('init')
  .description('Create and register a new agent wallet (safe to re-run)')
  .option('--human', 'Human-readable output')
  .action(async (opts: { human?: boolean }) => {
    const human = isHumanMode(opts.human);

    if (await keystoreExists()) {
      const keystore = await loadKeystore();
      if (human) {
        console.log('Wallet already exists:', keystore.walletAddress);
      } else {
        printResult({ address: keystore.walletAddress, agentId: null }, human);
      }
      return;
    }

    const { privateKey, address } = generateKeypair();

    // Register device with backend
    const res = await fetch(`${API_URL}/api/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: address }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Device registration failed (${res.status}): ${text}`);
    }

    const { deviceId, apiToken, deviceEncryptionKey, agentId } = (await res.json()) as {
      deviceId: string;
      apiToken: string;
      deviceEncryptionKey: string;
      agentId: string;
    };

    const encryptedKey = encryptPrivateKey(deviceEncryptionKey, privateKey);

    await saveKeystore({ encryptedKey, walletAddress: address, deviceId, apiToken });

    if (human) {
      console.log('Wallet created:', address);
      console.log('Agent ID:', agentId);
      console.log('Keystore saved to:', getKeystorePath());
    } else {
      printResult({ address, agentId }, human);
    }
  });

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

async function pollAgentId(address: string, maxWaitMs = 60_000): Promise<string | null> {
  const interval = 3_000;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    try {
      const res = await fetch(`${API_URL}/api/identity/status?address=${address}`);
      if (res.ok) {
        const data = (await res.json()) as { agentId?: string | null };
        if (data.agentId) return data.agentId;
      }
    } catch {
      // ignore transient errors, keep polling
    }
  }
  return null;
}

export const initCommand = new Command('init')
  .description('Create and register a new agent wallet (safe to re-run)')
  .option('--human', 'Human-readable output')
  .action(async (opts: { human?: boolean }) => {
    const human = isHumanMode(opts.human);

    if (await keystoreExists()) {
      const keystore = await loadKeystore();
      // Poll for agentId if not yet assigned (background registration in progress)
      let agentId = keystore.agentId;
      if (!agentId) {
        agentId = await pollAgentId(keystore.walletAddress);
        if (agentId) {
          await saveKeystore({ ...keystore, agentId });
        }
      }
      if (human) {
        console.log('Wallet already exists:', keystore.walletAddress);
        if (agentId) console.log('Agent ID:', agentId);
      } else {
        printResult({ address: keystore.walletAddress, agentId }, human);
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

    const {
      deviceId,
      apiToken,
      deviceEncryptionKey,
      agentId: initialAgentId,
    } = (await res.json()) as {
      deviceId: string;
      apiToken: string;
      deviceEncryptionKey: string;
      agentId: string | null;
    };

    const encryptedKey = encryptPrivateKey(deviceEncryptionKey, privateKey);

    // agentId may be null if on-chain registration is still pending — poll for it
    let agentId: string | null = initialAgentId;
    await saveKeystore({ encryptedKey, walletAddress: address, deviceId, apiToken, agentId });

    if (!agentId) {
      agentId = await pollAgentId(address);
      if (agentId) {
        const keystore = await loadKeystore();
        await saveKeystore({ ...keystore, agentId });
      }
    }

    if (human) {
      console.log('Wallet created:', address);
      console.log('Agent ID:', agentId ?? '(pending — run `taskmarket init` again shortly)');
      console.log('Keystore saved to:', getKeystorePath());
      console.log('');
      console.log('Next: deposit Base Sepolia USDC to your wallet before creating tasks.');
      console.log('Run `taskmarket deposit` for deposit instructions.');
    } else {
      printResult({ address, agentId }, human);
    }
  });

import { Command } from 'commander';
import {
  generateKeypair,
  encryptPrivateKey,
  saveKeystore,
  keystoreExists,
  loadKeystore,
} from '../lib/keystore.js';
import { API_URL, apiGet } from '../lib/api.js';
import { printResult } from '../lib/output.js';
import { pollAgentId } from '../lib/agent.js';
import { deriveCompressedPublicKey } from '../lib/encryption.js';

type NetworkInfo = {
  chainId: number;
  usdcAddress: string;
  contractAddress: string;
  networkName: string;
  explorerUrl: string;
};

export const initCommand = new Command('init')
  .description('Create and register a new agent wallet (safe to re-run)')
  .action(async () => {
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

      let networkInfo: NetworkInfo | undefined;
      try {
        const response = (await apiGet('/trpc/network.info')) as {
          result: { data: NetworkInfo };
        };
        networkInfo = response.result.data;
      } catch {
        // Non-fatal
      }

      printResult({
        address: keystore.walletAddress,
        agentId,
        network: networkInfo?.networkName,
        chainId: networkInfo?.chainId,
      });
      return;
    }

    const { privateKey, address } = generateKeypair();
    const publicKey = deriveCompressedPublicKey(privateKey);

    // Register device with backend
    const res = await fetch(`${API_URL}/api/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: address, publicKey }),
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

    // Fetch network info to show funding details
    let networkInfo: NetworkInfo | undefined;
    try {
      const response = (await apiGet('/trpc/network.info')) as {
        result: { data: NetworkInfo };
      };
      networkInfo = response.result.data;
    } catch {
      // Non-fatal — show fallback text if backend unreachable
    }

    printResult({
      address,
      agentId,
      network: networkInfo?.networkName,
      chainId: networkInfo?.chainId,
    });
  });

import { Command } from 'commander';
import {
  generateKeypair,
  encryptPrivateKey,
  saveKeystore,
  keystoreExists,
  getKeystorePath,
  loadKeystore,
} from '../lib/keystore.js';
import { API_URL, apiGet } from '../lib/api.js';
import { isHumanMode, printResult } from '../lib/output.js';
import { pollAgentId } from '../lib/agent.js';

type NetworkInfo = {
  chainId: number;
  usdcAddress: string;
  contractAddress: string;
  networkName: string;
  explorerUrl: string;
};

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

      let networkInfo: NetworkInfo | undefined;
      try {
        const response = (await apiGet('/trpc/network.info')) as {
          result: { data: NetworkInfo };
        };
        networkInfo = response.result.data;
      } catch {
        // Non-fatal
      }

      if (human) {
        console.log('Wallet already exists:', keystore.walletAddress);
        if (agentId) console.log('Agent ID:', agentId);
        if (networkInfo) {
          console.log('');
          console.log('Network info:');
          console.log(`  Network:  ${networkInfo.networkName} (chain ID ${networkInfo.chainId})`);
          console.log('  Currency: USDC');
          console.log(`  Contract: ${networkInfo.usdcAddress}`);
        }
      } else {
        printResult(
          {
            address: keystore.walletAddress,
            agentId,
            network: networkInfo?.networkName,
            chainId: networkInfo?.chainId,
          },
          human
        );
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

    if (human) {
      console.log('Wallet created:', address);
      console.log('Agent ID:', agentId ?? '(pending — run `taskmarket init` again shortly)');
      console.log('Keystore saved to:', getKeystorePath());
      console.log('');
      console.log('Fund your wallet to start using Taskmarket:');
      console.log(`  Address:  ${address}`);
      if (networkInfo) {
        console.log(`  Network:  ${networkInfo.networkName} (chain ID ${networkInfo.chainId})`);
        console.log('  Currency: USDC');
        console.log(`  Contract: ${networkInfo.usdcAddress}`);
      } else {
        console.log('  Run `taskmarket deposit` for network and deposit instructions.');
      }
    } else {
      printResult(
        { address, agentId, network: networkInfo?.networkName, chainId: networkInfo?.chainId },
        human
      );
    }
  });

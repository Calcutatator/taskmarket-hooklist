import { Command } from 'commander';
import {
  generateKeypair,
  encryptPrivateKey,
  saveKeystore,
  keystoreExists,
  loadKeystore,
} from '../lib/keystore.js';
import { API_URL, apiGet, apiPost } from '../lib/api.js';
import { printResult, printError } from '../lib/output.js';
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
  .option('--email <username>', 'Claim an email address (e.g. myagent)')
  .action(async (opts: { email?: string }) => {
    // Step 0: fail-fast email availability check (unauthenticated, before any other work)
    if (opts.email) {
      const check = (await apiGet(
        `/api/emails/check-username?username=${encodeURIComponent(opts.email)}`
      )) as { available: boolean };
      if (!check.available) {
        printError(`Email username "${opts.email}" is not available.`);
      }
    }

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

      // Re-run: register email if requested and not already set
      let emailAddress: string | null = null;
      if (opts.email) {
        try {
          const existing = (await apiGet(
            `/api/agents/stats?address=${keystore.walletAddress}`
          )) as { emailAddress?: string | null };
          if (existing.emailAddress) {
            emailAddress = existing.emailAddress;
          } else {
            const reg = (await apiPost('/api/emails/register', {
              deviceId: keystore.deviceId,
              apiToken: keystore.apiToken,
              username: opts.email,
            })) as { emailAddress: string };
            emailAddress = reg.emailAddress;
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(
            JSON.stringify({
              ok: false,
              error: `Email registration failed: ${msg}. Run: taskmarket email register --username ${opts.email}`,
            }) + '\n'
          );
        }
      }

      printResult({
        address: keystore.walletAddress,
        agentId,
        network: networkInfo?.networkName,
        chainId: networkInfo?.chainId,
        emailAddress,
      });
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

    // Register email if requested
    let emailAddress: string | null = null;
    if (opts.email) {
      try {
        const reg = (await apiPost('/api/emails/register', {
          deviceId,
          apiToken,
          username: opts.email,
        })) as { emailAddress: string };
        emailAddress = reg.emailAddress;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          JSON.stringify({
            ok: false,
            error: `Email registration failed: ${msg}. Run: taskmarket email register --username ${opts.email}`,
          }) + '\n'
        );
      }
    }

    printResult({
      address,
      agentId,
      network: networkInfo?.networkName,
      chainId: networkInfo?.chainId,
      emailAddress,
    });
  });

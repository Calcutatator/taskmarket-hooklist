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
import { deriveCompressedPublicKey } from '../lib/encryption.js';

type NetworkInfo = {
  chainId: number;
  usdcAddress: string;
  contractAddress: string;
  networkName: string;
  explorerUrl: string;
};

export function sanitizeEmailUsername(agentId: string, suffix: string): string | null {
  const maxBase = 30 - 1 - suffix.length;
  if (maxBase < 2) return null;

  const base = agentId
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxBase)
    .replace(/-+$/, '');

  if (base.length < 2) return null;

  const candidate = `${base}-${suffix}`;
  return /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(candidate) ? candidate : null;
}

async function tryRegisterEmail(
  deviceId: string,
  apiToken: string,
  username: string,
  explicit: boolean
): Promise<string | null> {
  try {
    const reg = (await apiPost('/api/emails/register', {
      deviceId,
      apiToken,
      username,
    })) as { emailAddress: string };
    return reg.emailAddress;
  } catch (err: unknown) {
    if (explicit) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        JSON.stringify({
          ok: false,
          error: `Email registration failed: ${msg}. Run: taskmarket email register --username ${username}`,
        }) + '\n'
      );
    }
    return null;
  }
}

export const initCommand = new Command('init')
  .description('Create and register a new agent wallet (safe to re-run)')
  .option(
    '--email <username>',
    'Claim a custom email username (default: auto-generated from agent ID)'
  )
  .action(async (opts: { email?: string }) => {
    // Fail-fast availability check for explicit --email before doing any other work
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

      // Check for existing email first
      let emailAddress: string | null = null;
      try {
        const existing = (await apiGet(`/api/agents/stats?address=${keystore.walletAddress}`)) as {
          emailAddress?: string | null;
        };
        emailAddress = existing.emailAddress ?? null;
      } catch {
        // Non-fatal
      }

      if (!emailAddress) {
        const username =
          opts.email ??
          (agentId && networkInfo
            ? sanitizeEmailUsername(agentId, String(networkInfo.chainId))
            : null);
        if (username) {
          emailAddress = await tryRegisterEmail(
            keystore.deviceId,
            keystore.apiToken,
            username,
            !!opts.email
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
    const publicKey = deriveCompressedPublicKey(privateKey);

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

    let agentId: string | null = initialAgentId;
    await saveKeystore({
      encryptedKey,
      walletAddress: address,
      deviceId,
      apiToken,
      agentId,
      keyServerUrl: API_URL,
    });

    if (!agentId) {
      agentId = await pollAgentId(address);
      if (agentId) {
        const keystore = await loadKeystore();
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

    const username =
      opts.email ??
      (agentId && networkInfo ? sanitizeEmailUsername(agentId, String(networkInfo.chainId)) : null);
    const emailAddress = username
      ? await tryRegisterEmail(deviceId, apiToken, username, !!opts.email)
      : null;

    printResult({
      address,
      agentId,
      network: networkInfo?.networkName,
      chainId: networkInfo?.chainId,
      emailAddress,
    });
  });

import { Command } from 'commander';
import { LegalBundleSchema, buildDeviceRegisterMessage } from '@taskmarket/shared';
import { privateKeyToAccount } from 'viem/accounts';
import {
  generateKeypair,
  encryptPrivateKey,
  saveKeystore,
  keystoreExists,
  loadKeystore,
} from '../lib/keystore.js';
import { API_ORIGIN, API_URL, apiGet, apiPost } from '../lib/api.js';
import { printResult, printError, printWarning } from '../lib/output.js';
import { pollAgentId } from '../lib/agent.js';
import { registerDevice } from '../lib/device-registration.js';
import { deriveCompressedPublicKey } from '../lib/encryption.js';
import { acceptLegalBundle } from './legal/index.js';

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
      // A warning, not the command's result: `init` goes on to succeed without an email address,
      // so this must not exit and must not carry `pending` -- nothing about the wallet the
      // command was asked to create is in doubt. It goes through lib/output.ts all the same, so
      // the failure envelope is still built in exactly one place.
      printWarning(
        `Email registration failed: ${msg}. Run: taskmarket email register --username ${username}`
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
  .option(
    '--yes',
    'Confirm legal acceptance non-interactively after reviewing every current policy'
  )
  .action(async (opts: { email?: string; yes?: boolean }) => {
    // Fail-fast availability check for explicit --email before doing any other work
    if (opts.email) {
      const check = (await apiGet(
        `/api/emails/check-username?username=${encodeURIComponent(opts.email)}`
      )) as { available: boolean };
      if (!check.available) {
        printError(`Email username "${opts.email}" is not available.`);
        return;
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
    const legalBundle = LegalBundleSchema.parse(await apiGet('/api/legal/current'));
    const legalAcceptance = legalBundle.enforcementEnabled
      ? await acceptLegalBundle({
          assumeYes: Boolean(opts.yes),
          bundle: legalBundle,
          signMessage: (message) =>
            privateKeyToAccount(privateKey as `0x${string}`).signMessage({ message }),
          walletAddress: address,
        })
      : undefined;

    const deviceRegisterSignature = await privateKeyToAccount(
      privateKey as `0x${string}`
    ).signMessage({ message: buildDeviceRegisterMessage(address) });

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

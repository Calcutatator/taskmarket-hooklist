import { Command } from 'commander';
import { apiGet, apiPost } from '../lib/api.js';
import { loadKeystore, saveKeystore } from '../lib/keystore.js';
import { printResult } from '../lib/output.js';
import {
  createXmtpClient,
  listenForEnvelopes,
  runQueryWithClient,
  sendMessageEnvelope,
} from '../lib/xmtp-client.js';
import { buildEnvelope } from '../lib/xmtp-envelope.js';

function isAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function parseJsonPayload(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Payload must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

async function resolveInboxId(to: string): Promise<string> {
  if (!isAddress(to)) {
    return to;
  }

  const result = (await apiGet(`/api/xmtp/resolve?address=${encodeURIComponent(to)}`)) as {
    inboxId: string | null;
  };

  if (!result.inboxId) {
    throw new Error(`No XMTP inbox found for address ${to}`);
  }

  return result.inboxId;
}

function getDefaultQueryTimeoutMs(): number {
  const raw = process.env.TASKMARKET_XMTP_QUERY_TIMEOUT_MS;
  if (!raw) {
    return 10_000;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('TASKMARKET_XMTP_QUERY_TIMEOUT_MS must be a positive number');
  }

  return Math.floor(parsed);
}

export const xmtpCommand = new Command('xmtp').description('Manage XMTP messaging for this agent');

xmtpCommand
  .command('init')
  .description('Initialize XMTP client and register installation metadata with backend')
  .action(async () => {
    const keystore = await loadKeystore();
    const client = await createXmtpClient({
      walletAddress: keystore.walletAddress,
      existingInboxId: keystore.xmtpInboxId,
      existingInstallationId: keystore.xmtpInstallationId,
      existingDbPath: keystore.xmtpDbPath,
    });

    const status = (await apiPost('/api/xmtp/bootstrap', {
      deviceId: keystore.deviceId,
      apiToken: keystore.apiToken,
      inboxId: client.inboxId,
      installationId: client.installationId,
      dbPath: client.dbPath,
      clientVersion: process.env.npm_package_version ?? 'unknown',
    })) as {
      inboxId: string;
      installationId: string;
      policyMode: 'allowlist' | 'open';
    };

    await saveKeystore({
      ...keystore,
      xmtpInboxId: status.inboxId,
      xmtpInstallationId: status.installationId,
      xmtpDbPath: client.dbPath,
    });

    printResult({
      inboxId: status.inboxId,
      installationId: status.installationId,
      policyMode: status.policyMode,
    });
  });

xmtpCommand
  .command('status')
  .description('Check XMTP status and active installation state')
  .action(async () => {
    const keystore = await loadKeystore();
    const result = (await apiGet(
      `/api/xmtp/status?deviceId=${encodeURIComponent(keystore.deviceId)}&apiToken=${encodeURIComponent(keystore.apiToken)}`
    )) as {
      inboxId: string | null;
      enabled: boolean;
      policyMode: 'allowlist' | 'open';
      lastSeenAt: string | null;
      activeInstallations: Array<{ installationId: string; status: string; lastSeenAt: string }>;
    };

    printResult(result);
  });

xmtpCommand
  .command('send')
  .description('Send a structured XMTP envelope to a peer')
  .requiredOption('--to <addressOrInboxId>', 'Target wallet address or inboxId')
  .requiredOption('--type <type>', 'Envelope type')
  .requiredOption('--json <payloadJson>', 'JSON object payload')
  .action(async (options: { to: string; type: string; json: string }) => {
    const payload = parseJsonPayload(options.json);
    const keystore = await loadKeystore();
    const client = await createXmtpClient({
      walletAddress: keystore.walletAddress,
      existingInboxId: keystore.xmtpInboxId,
      existingInstallationId: keystore.xmtpInstallationId,
      existingDbPath: keystore.xmtpDbPath,
    });

    const toInboxId = await resolveInboxId(options.to);
    const senderInboxId = keystore.xmtpInboxId ?? client.inboxId;
    const envelope = buildEnvelope({
      type: options.type,
      senderInboxId,
      senderAddress: keystore.walletAddress,
      payload,
    });

    await sendMessageEnvelope(client, toInboxId, envelope);

    printResult({
      sent: true,
      requestId: envelope.requestId,
      toInboxId,
    });
  });

xmtpCommand
  .command('query')
  .description('Send query envelope and wait for correlated response')
  .requiredOption('--to <addressOrInboxId>', 'Target wallet address or inboxId')
  .requiredOption('--type <type>', 'Envelope type')
  .requiredOption('--json <payloadJson>', 'JSON object payload')
  .option('--timeout-ms <timeoutMs>', 'Query timeout in milliseconds')
  .action(async (options: { to: string; type: string; json: string; timeoutMs?: string }) => {
    const payload = parseJsonPayload(options.json);
    const timeoutMs = options.timeoutMs ? Number(options.timeoutMs) : getDefaultQueryTimeoutMs();
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error('timeout-ms must be a positive number');
    }

    const keystore = await loadKeystore();
    const client = await createXmtpClient({
      walletAddress: keystore.walletAddress,
      existingInboxId: keystore.xmtpInboxId,
      existingInstallationId: keystore.xmtpInstallationId,
      existingDbPath: keystore.xmtpDbPath,
    });

    const toInboxId = await resolveInboxId(options.to);
    const senderInboxId = keystore.xmtpInboxId ?? client.inboxId;
    const envelope = buildEnvelope({
      type: options.type,
      senderInboxId,
      senderAddress: keystore.walletAddress,
      payload,
      deadlineMs: Math.floor(timeoutMs),
    });

    const response = await runQueryWithClient({
      client,
      toInboxId,
      envelope,
      timeoutMs: Math.floor(timeoutMs),
    });

    printResult({
      requestId: envelope.requestId,
      response,
    });
  });

xmtpCommand
  .command('listen')
  .description('Listen for inbound XMTP envelopes')
  .option('--types <typesCsv>', 'Comma-separated allowed message types')
  .action(async (options: { types?: string }) => {
    const keystore = await loadKeystore();
    const client = await createXmtpClient({
      walletAddress: keystore.walletAddress,
      existingInboxId: keystore.xmtpInboxId,
      existingInstallationId: keystore.xmtpInstallationId,
      existingDbPath: keystore.xmtpDbPath,
    });

    const allowedTypes = options.types
      ? new Set(
          options.types
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
        )
      : undefined;

    let stopped = false;
    const stop = () => {
      stopped = true;
    };

    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);

    try {
      await listenForEnvelopes({
        client,
        shouldStop: () => stopped,
        allowedTypes,
        onEnvelope: (envelope) => {
          printResult(envelope);
        },
      });
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    }
  });

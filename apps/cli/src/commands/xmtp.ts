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
  // Raw inboxId passed directly — no resolution needed
  if (!isAddress(to) && to.length === 64 && /^[0-9a-f]+$/.test(to)) {
    return to;
  }

  const param = isAddress(to)
    ? `address=${encodeURIComponent(to)}`
    : `agentId=${encodeURIComponent(to)}`;

  const result = (await apiGet(`/api/xmtp/resolve?${param}`)) as {
    inboxId: string | null;
  };

  if (!result.inboxId) {
    const label = isAddress(to) ? `address ${to}` : `agent "${to}"`;
    throw new Error(`No XMTP inbox found for ${label}`);
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
      keystore,
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

    printResult({ policyMode: status.policyMode });
  });

xmtpCommand
  .command('status')
  .description('Check XMTP status and active installation state')
  .action(async () => {
    const keystore = await loadKeystore();
    const result = (await apiGet(
      `/api/xmtp/status?deviceId=${encodeURIComponent(keystore.deviceId)}`,
      {
        headers: {
          'x-taskmarket-api-token': keystore.apiToken,
        },
      }
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
      keystore,
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
      keystore,
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
      keystore,
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
    const abortController = new AbortController();
    const stop = () => {
      stopped = true;
      abortController.abort();
    };

    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);

    try {
      await listenForEnvelopes({
        client,
        shouldStop: () => stopped,
        allowedTypes,
        signal: abortController.signal,
        onEnvelope: (envelope) => {
          printResult(envelope);
        },
      });
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    }
  });

xmtpCommand
  .command('heartbeat')
  .description('Send a one-shot heartbeat to keep the XMTP installation active')
  .action(async () => {
    const keystore = await loadKeystore();
    if (!keystore.xmtpInstallationId) {
      throw new Error('XMTP not initialized. Run `taskmarket xmtp init` first.');
    }

    const result = await apiPost('/api/xmtp/heartbeat', {
      deviceId: keystore.deviceId,
      apiToken: keystore.apiToken,
      installationId: keystore.xmtpInstallationId,
    });
    printResult(result as Record<string, unknown>);
  });

const peersCommand = xmtpCommand
  .command('peers')
  .description('Manage taskmarket peer messaging policies');

peersCommand
  .command('list')
  .description('List per-peer messaging policies stored on the backend')
  .action(async () => {
    const keystore = await loadKeystore();
    const result = (await apiGet(
      `/api/xmtp/peers?deviceId=${encodeURIComponent(keystore.deviceId)}`,
      { headers: { 'x-taskmarket-api-token': keystore.apiToken } }
    )) as { policies: unknown[] };
    printResult(result);
  });

peersCommand
  .command('set')
  .description('Set messaging policy for a specific peer')
  .requiredOption('--to <agentIdOrAddrOrInboxId>', 'Target agent ID, wallet address, or inboxId')
  .requiredOption('--policy <policy>', 'Policy: allow | deny | quarantine')
  .option('--reason <reason>', 'Optional reason text')
  .action(async (options: { to: string; policy: string; reason?: string }) => {
    const validPolicies = ['allow', 'deny', 'quarantine'];
    if (!validPolicies.includes(options.policy)) {
      throw new Error(`--policy must be one of: ${validPolicies.join(', ')}`);
    }
    const keystore = await loadKeystore();
    const peerInboxId = await resolveInboxId(options.to);
    const result = await apiPost('/api/xmtp/peers', {
      deviceId: keystore.deviceId,
      apiToken: keystore.apiToken,
      peerInboxId,
      policy: options.policy,
      reason: options.reason,
    });
    printResult(result as Record<string, unknown>);
  });

const allowlistCommand = xmtpCommand
  .command('allowlist')
  .description('Manage XMTP SDK consent allowlist (protocol-level)');

allowlistCommand
  .command('add')
  .description('Allow messages from a peer inbox (XMTP SDK consent)')
  .requiredOption('--to <agentIdOrAddrOrInboxId>', 'Target agent ID, wallet address, or inboxId')
  .action(async (options: { to: string }) => {
    const keystore = await loadKeystore();
    const client = await createXmtpClient({
      walletAddress: keystore.walletAddress,
      existingInboxId: keystore.xmtpInboxId,
      existingInstallationId: keystore.xmtpInstallationId,
      existingDbPath: keystore.xmtpDbPath,
      keystore,
    });
    const targetInboxId = await resolveInboxId(options.to);
    if (!client.setConsentState) {
      throw new Error('setConsentState not available in this XMTP client mode');
    }
    await client.setConsentState(targetInboxId, 'allowed');
    printResult({ ok: true, inboxId: targetInboxId, state: 'allowed' });
  });

allowlistCommand
  .command('remove')
  .description('Deny messages from a peer inbox (XMTP SDK consent)')
  .requiredOption('--to <agentIdOrAddrOrInboxId>', 'Target agent ID, wallet address, or inboxId')
  .action(async (options: { to: string }) => {
    const keystore = await loadKeystore();
    const client = await createXmtpClient({
      walletAddress: keystore.walletAddress,
      existingInboxId: keystore.xmtpInboxId,
      existingInstallationId: keystore.xmtpInstallationId,
      existingDbPath: keystore.xmtpDbPath,
      keystore,
    });
    const targetInboxId = await resolveInboxId(options.to);
    if (!client.setConsentState) {
      throw new Error('setConsentState not available in this XMTP client mode');
    }
    await client.setConsentState(targetInboxId, 'denied');
    printResult({ ok: true, inboxId: targetInboxId, state: 'denied' });
  });

allowlistCommand
  .command('list')
  .description('List all XMTP SDK consent entries')
  .action(async () => {
    const keystore = await loadKeystore();
    const client = await createXmtpClient({
      walletAddress: keystore.walletAddress,
      existingInboxId: keystore.xmtpInboxId,
      existingInstallationId: keystore.xmtpInstallationId,
      existingDbPath: keystore.xmtpDbPath,
      keystore,
    });
    if (!client.listConsentEntries) {
      throw new Error('listConsentEntries not available in this XMTP client mode');
    }
    const entries = await client.listConsentEntries();
    printResult({ entries });
  });

xmtpCommand
  .command('purge')
  .description('Revoke stale XMTP installations that have missed heartbeats')
  .action(async () => {
    const keystore = await loadKeystore();
    const result = await apiPost('/api/xmtp/purge', {
      deviceId: keystore.deviceId,
      apiToken: keystore.apiToken,
    });
    printResult(result as Record<string, unknown>);
  });

import { privateKeyToAccount } from 'viem/accounts';
import { buildEnvelope, decodeEnvelope } from '../src/lib/xmtp-envelope.js';
import { createXmtpClient, sendMessageEnvelope } from '../src/lib/xmtp-client.js';

function requirePrivateKey(name: string): `0x${string}` {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be a 32-byte hex private key`);
  }
  return value as `0x${string}`;
}

function getTimeoutMs(): number {
  const raw = process.env.XMTP_SMOKE_TIMEOUT_MS ?? '45000';
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('XMTP_SMOKE_TIMEOUT_MS must be a positive number');
  }
  return Math.floor(parsed);
}

async function waitForEnvelope(options: {
  client: Awaited<ReturnType<typeof createXmtpClient>>;
  requestId: string;
  timeoutMs: number;
}) {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), options.timeoutMs);

  try {
    for await (const raw of options.client.streamMessages({ signal: abortController.signal })) {
      const envelope = decodeEnvelope(raw);
      if (envelope.requestId === options.requestId) {
        abortController.abort();
        return envelope;
      }
    }

    throw new Error('Stream closed before receiving expected envelope');
  } catch (error) {
    if (abortController.signal.aborted) {
      throw new Error(
        `Timed out waiting ${options.timeoutMs}ms for envelope ${options.requestId}`
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  process.env.TASKMARKET_XMTP_ENV = 'production';

  const keyA =
    process.env.REQUESTER_PRIVATE_KEY || process.env.XMTP_SMOKE_AGENT_A_PRIVATE_KEY
      ? requirePrivateKey(
          process.env.REQUESTER_PRIVATE_KEY
            ? 'REQUESTER_PRIVATE_KEY'
            : 'XMTP_SMOKE_AGENT_A_PRIVATE_KEY'
        )
      : undefined;
  const keyB =
    process.env.WORKER_PRIVATE_KEY || process.env.XMTP_SMOKE_AGENT_B_PRIVATE_KEY
      ? requirePrivateKey(
          process.env.WORKER_PRIVATE_KEY
            ? 'WORKER_PRIVATE_KEY'
            : 'XMTP_SMOKE_AGENT_B_PRIVATE_KEY'
        )
      : undefined;

  if (!keyA || !keyB) {
    throw new Error(
      'Set REQUESTER_PRIVATE_KEY and WORKER_PRIVATE_KEY (or XMTP_SMOKE_AGENT_A_PRIVATE_KEY and XMTP_SMOKE_AGENT_B_PRIVATE_KEY)'
    );
  }

  if (keyA.toLowerCase() === keyB.toLowerCase()) {
    throw new Error('Smoke requires two distinct private keys');
  }

  const timeoutMs = getTimeoutMs();
  const accountA = privateKeyToAccount(keyA);
  const accountB = privateKeyToAccount(keyB);

  console.log('=== XMTP Live Smoke Test (Offline Catch-Up) ===');
  console.log('agentA:', accountA.address);
  console.log('agentB:', accountB.address);

  const clientA = await createXmtpClient({
    walletAddress: accountA.address,
    runtimeSigner: accountA,
  });
  const clientB = await createXmtpClient({
    walletAddress: accountB.address,
    runtimeSigner: accountB,
  });

  console.log('inboxA:', clientA.inboxId);
  console.log('inboxB:', clientB.inboxId);

  const queryEnvelope = buildEnvelope({
    type: 'smoke.query',
    senderInboxId: clientA.inboxId,
    senderAddress: accountA.address,
    payload: {
      scenario: 'offline-catch-up',
      sentAt: new Date().toISOString(),
    },
  });

  console.log('Step 1/6: send while receiver is offline...');
  await sendMessageEnvelope(clientA, clientB.inboxId, queryEnvelope);

  console.log('Step 2/6: start receiver stream and wait for catch-up delivery...');
  const received = await waitForEnvelope({
    client: clientB,
    requestId: queryEnvelope.requestId,
    timeoutMs,
  });

  console.log('Step 3/6: validate envelope correlation...');
  if (received.requestId !== queryEnvelope.requestId) {
    throw new Error(
      `Expected requestId ${queryEnvelope.requestId} but got ${received.requestId}`
    );
  }
  if (received.senderInboxId !== clientA.inboxId) {
    throw new Error(`Expected sender inbox ${clientA.inboxId} but got ${received.senderInboxId}`);
  }
  console.log('offline catch-up requestId:', received.requestId);

  console.log('Step 4/6: allowlist add — allow clientB in clientA consent store...');
  if (!clientA.setConsentState) {
    throw new Error('setConsentState not available on production client');
  }
  await clientA.setConsentState(clientB.inboxId, 'allowed');
  console.log('allowlist add ok');

  console.log('Step 5/6: allowlist check — verify clientB is allowed in clientA consent store...');
  if (!clientA.getConsentState) {
    throw new Error('getConsentState not available on production client');
  }
  const consentState = await clientA.getConsentState(clientB.inboxId);
  if (consentState !== 'allowed') {
    throw new Error(`Expected consent state 'allowed' but got '${consentState}'`);
  }
  console.log('allowlist check ok, state:', consentState);

  console.log('Step 6/6: allowlist remove — deny clientB in clientA consent store...');
  await clientA.setConsentState(clientB.inboxId, 'denied');
  console.log('allowlist remove ok');

  console.log('=== XMTP live smoke test passed ===');
}

main().catch((error) => {
  console.error('Fatal:', error);
  process.exit(1);
});

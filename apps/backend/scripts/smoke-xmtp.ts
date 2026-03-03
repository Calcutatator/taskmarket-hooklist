/**
 * XMTP control-plane smoke test.
 *
 * Steps:
 * 1. Register two devices
 * 2. Bootstrap XMTP metadata for both
 * 3. Set/list peer policy
 * 4. Resolve peer inbox by address
 * 5. Check status and send heartbeat
 */
import { randomUUID } from 'crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { API_URL, get, log, ok, post } from './_x402';

async function registerDevice(walletAddress: string) {
  return (await post('/api/devices', { walletAddress })) as {
    deviceId: string;
    apiToken: string;
  };
}

async function main() {
  const keyA =
    (process.env.REQUESTER_PRIVATE_KEY as `0x${string}` | undefined) ??
    (process.env.DEV_PRIVATE_KEY as `0x${string}` | undefined);
  const keyB =
    (process.env.WORKER_PRIVATE_KEY as `0x${string}` | undefined) ??
    (process.env.DEV_PRIVATE_KEY as `0x${string}` | undefined);

  if (!keyA || !keyB) {
    throw new Error('Set REQUESTER_PRIVATE_KEY/WORKER_PRIVATE_KEY or DEV_PRIVATE_KEY');
  }
  if (keyA.toLowerCase() === keyB.toLowerCase()) {
    throw new Error('REQUESTER_PRIVATE_KEY and WORKER_PRIVATE_KEY must be different');
  }

  const agentA = privateKeyToAccount(keyA);
  const agentB = privateKeyToAccount(keyB);

  console.log('=== Taskmarket Smoke Test - XMTP Control Plane ===');
  console.log('api:', API_URL);
  console.log('agentA:', agentA.address);
  console.log('agentB:', agentB.address);

  log('1/5', 'Registering devices...');
  const deviceA = await registerDevice(agentA.address);
  const deviceB = await registerDevice(agentB.address);
  ok('deviceA', deviceA.deviceId);
  ok('deviceB', deviceB.deviceId);

  const inboxA = `smoke-inbox-${randomUUID()}`;
  const inboxB = `smoke-inbox-${randomUUID()}`;
  const installationA = `smoke-install-${randomUUID()}`;
  const installationB = `smoke-install-${randomUUID()}`;

  log('2/5', 'Bootstrapping XMTP metadata...');
  await post('/api/xmtp/bootstrap', {
    deviceId: deviceA.deviceId,
    apiToken: deviceA.apiToken,
    inboxId: inboxA,
    installationId: installationA,
  });
  await post('/api/xmtp/bootstrap', {
    deviceId: deviceB.deviceId,
    apiToken: deviceB.apiToken,
    inboxId: inboxB,
    installationId: installationB,
  });
  ok('bootstrapped', true);

  log('3/5', 'Setting and listing peer policy...');
  await post('/api/xmtp/peers', {
    deviceId: deviceA.deviceId,
    apiToken: deviceA.apiToken,
    peerInboxId: inboxB,
    policy: 'allow',
    reason: 'smoke test peer',
  });

  const policies = (await get(
    `/api/xmtp/peers?deviceId=${encodeURIComponent(deviceA.deviceId)}`,
    {
      headers: { 'x-taskmarket-api-token': deviceA.apiToken },
    }
  )) as {
    policies: Array<{ peerInboxId: string; policy: string }>;
  };

  if (!policies.policies.some((entry) => entry.peerInboxId === inboxB && entry.policy === 'allow')) {
    throw new Error('Peer policy not found in list response');
  }
  ok('policy rows', policies.policies.length);

  log('4/5', 'Resolving peer by address...');
  const resolved = (await get(
    `/api/xmtp/resolve?address=${encodeURIComponent(agentB.address)}`
  )) as {
    inboxId: string | null;
  };

  if (resolved.inboxId !== inboxB) {
    throw new Error(`Expected inbox ${inboxB} but got ${resolved.inboxId}`);
  }
  ok('resolved inbox', resolved.inboxId);

  log('5/5', 'Checking status and heartbeat...');
  const status = (await get(
    `/api/xmtp/status?deviceId=${encodeURIComponent(deviceA.deviceId)}`,
    {
      headers: { 'x-taskmarket-api-token': deviceA.apiToken },
    }
  )) as {
    enabled: boolean;
    inboxId: string | null;
  };

  if (!status.enabled || status.inboxId !== inboxA) {
    throw new Error('Unexpected XMTP status payload');
  }

  await post('/api/xmtp/heartbeat', {
    deviceId: deviceA.deviceId,
    apiToken: deviceA.apiToken,
    installationId: installationA,
  });
  ok('heartbeat', 'ok');

  console.log('\n=== XMTP control-plane smoke test passed ===');
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

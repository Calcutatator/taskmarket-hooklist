/**
 * Broadcast smoke test: exercises the broadcast endpoint against a running backend.
 *
 * Steps:
 *  1. Register two devices and claim email addresses
 *  2. Reject broadcast with wrong admin secret
 *  3. Send broadcast to all agents
 *  4. Verify both agents received the email in their inboxes
 *  5. Send filtered broadcast (actorType: agent) — both agents are CLI-registered, so both receive
 *  6. Send broadcast with skills filter targeting a skill neither agent has — zero recipients
 *
 * Usage:
 *   ADMIN_SECRET=your-secret API_URL=http://localhost:3000 npx tsx scripts/smoke-broadcast.ts
 */
import { randomBytes } from 'crypto';
import { log, ok, get, post, registerDevice, randomAccount, API_URL } from './_x402';

const ADMIN_SECRET = process.env.ADMIN_SECRET;
if (!ADMIN_SECRET) {
  process.stderr.write('ADMIN_SECRET env var is required\n');
  process.exit(1);
}

function randomUsername(): string {
  return 'smoke-' + randomBytes(4).toString('hex');
}

async function registerEmail(
  deviceId: string,
  apiToken: string,
  username: string
): Promise<string> {
  const result = (await post('/api/emails/register', { deviceId, apiToken, username })) as {
    emailAddress: string;
  };
  return result.emailAddress;
}

async function listInbox(deviceId: string, apiToken: string, unread = false): Promise<unknown[]> {
  const params = new URLSearchParams({ deviceId, apiToken, limit: '20' });
  if (unread) params.set('unread', 'true');
  const result = (await get(`/api/emails/list?${params.toString()}`)) as { emails: unknown[] };
  return result.emails;
}

async function broadcastRaw(
  secret: string,
  subject: string,
  body: string,
  filters?: Record<string, unknown>
): Promise<{
  ok: boolean;
  data?: { sent: number; failed: number; total: number };
  error?: unknown;
}> {
  const r = await fetch(`${API_URL}/api/emails/broadcast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret },
    body: JSON.stringify({ subject, body, filters }),
  });
  const json = await r.json();
  // The endpoint returns its result body directly on success ({sent, failed, total}) and a
  // tRPC error object on failure -- neither is wrapped in an {ok, data} envelope, so success
  // must be read off the HTTP status rather than a field in the parsed body.
  if (!r.ok) {
    return { ok: false, error: json };
  }
  return { ok: true, data: json as { sent: number; failed: number; total: number } };
}

async function broadcast(
  subject: string,
  body: string,
  filters?: Record<string, unknown>
): Promise<{ sent: number; failed: number; total: number }> {
  const res = await broadcastRaw(ADMIN_SECRET as string, subject, body, filters);
  if (!res.ok || !res.data) throw new Error(`broadcast failed: ${JSON.stringify(res.error)}`);
  return res.data;
}

log('=== smoke-broadcast ===');
log(`API_URL: ${API_URL}`);

// Step 1: Register two agents
const agentA = randomAccount();
const agentB = randomAccount();
log(`\n[1] Registering agents ${agentA.address.slice(0, 10)} and ${agentB.address.slice(0, 10)}`);
const deviceA = await registerDevice(agentA);
const deviceB = await registerDevice(agentB);
const usernameA = randomUsername();
const usernameB = randomUsername();
const emailA = await registerEmail(deviceA.deviceId, deviceA.apiToken, usernameA);
const emailB = await registerEmail(deviceB.deviceId, deviceB.apiToken, usernameB);
log(`  Agent A email: ${emailA}`);
log(`  Agent B email: ${emailB}`);

// Step 2: Reject wrong secret
log('\n[2] Reject broadcast with wrong secret');
const rejectedRes = await broadcastRaw('wrong-secret-1234', 'Test', 'Body');
ok(!rejectedRes.ok, 'broadcast with wrong secret should be rejected');

// Step 3: Broadcast to all agents
log('\n[3] Broadcast to all agents');
const broadcastBody = `# Platform Update\n\nNew features are available.\n\n<!--metadata\n{"type":"announcement","tags":[]}\n-->`;
const result = await broadcast('Platform Update', broadcastBody);
log(`  sent: ${result.sent}, failed: ${result.failed}, total: ${result.total}`);
ok(result.total >= 2, 'broadcast total should include at least our two test agents');
ok(result.failed === 0, 'no sends should fail');

// Step 4: Verify both agents received the email
log('\n[4] Verify both agents received the email');
const inboxA = await listInbox(deviceA.deviceId, deviceA.apiToken, true);
const inboxB = await listInbox(deviceB.deviceId, deviceB.apiToken, true);
ok(inboxA.length >= 1, 'agent A should have at least one unread email');
ok(inboxB.length >= 1, 'agent B should have at least one unread email');

// Step 5: Filtered broadcast by actorType=agent (CLI-registered)
log('\n[5] Filtered broadcast: actorType=agent');
const filteredResult = await broadcast('Agent-only update', 'For CLI agents only.', {
  actorType: 'agent',
});
log(`  sent: ${filteredResult.sent}, total: ${filteredResult.total}`);
ok(filteredResult.total >= 2, 'both test agents are CLI-registered');

// Step 6: Skills filter with no matches
log('\n[6] Skills filter with no matching agents');
const noMatchResult = await broadcast('Skill-targeted update', 'For quantum-computing agents.', {
  skills: ['quantum-computing-xyz-no-match'],
});
log(`  sent: ${noMatchResult.sent}, total: ${noMatchResult.total}`);
ok(noMatchResult.total === 0, 'no agents have the test skill');

log('\n=== smoke-broadcast PASSED ===');

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
 *   ADMIN_SECRET=your-secret API_URL=http://localhost:3000 npx tsx src/scripts/smoke-broadcast.ts
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

console.log('=== smoke-broadcast ===');
console.log(`API_URL: ${API_URL}`);

// Step 1: Register two agents
const agentA = randomAccount();
const agentB = randomAccount();
log('1/6', `Registering agents ${agentA.address.slice(0, 10)} and ${agentB.address.slice(0, 10)}`);
const deviceA = await registerDevice(agentA);
const deviceB = await registerDevice(agentB);
const usernameA = randomUsername();
const usernameB = randomUsername();
const emailA = await registerEmail(deviceA.deviceId, deviceA.apiToken, usernameA);
const emailB = await registerEmail(deviceB.deviceId, deviceB.apiToken, usernameB);
console.log(`  Agent A email: ${emailA}`);
console.log(`  Agent B email: ${emailB}`);

// Step 2: Reject wrong secret
log('2/6', 'Reject broadcast with wrong secret');
const rejectedRes = await broadcastRaw('wrong-secret-1234', 'Test', 'Body');
if (rejectedRes.ok) throw new Error('broadcast with wrong secret should be rejected');
ok('broadcast with wrong secret rejected', true);

// Step 3: Broadcast to all agents
log('3/6', 'Broadcast to all agents');
const broadcastBody = `# Platform Update\n\nNew features are available.\n\n<!--metadata\n{"type":"announcement","tags":[]}\n-->`;
const result = await broadcast('Platform Update', broadcastBody);
console.log(`  sent: ${result.sent}, failed: ${result.failed}, total: ${result.total}`);
if (result.total < 2) {
  throw new Error(`Expected broadcast total >= 2, got ${result.total}`);
}
if (result.failed !== 0) {
  throw new Error(`Expected no failed sends, got ${result.failed}`);
}
ok('broadcast total includes both test agents', result.total);

// Step 4: Verify both agents received the email
log('4/6', 'Verify both agents received the email');
const inboxA = await listInbox(deviceA.deviceId, deviceA.apiToken, true);
const inboxB = await listInbox(deviceB.deviceId, deviceB.apiToken, true);
if (inboxA.length < 1) throw new Error('Agent A should have at least one unread email');
if (inboxB.length < 1) throw new Error('Agent B should have at least one unread email');
ok('both agents received the broadcast email', true);

// Step 5: Filtered broadcast by actorType=agent (CLI-registered)
log('5/6', 'Filtered broadcast: actorType=agent');
const filteredResult = await broadcast('Agent-only update', 'For CLI agents only.', {
  actorType: 'agent',
});
console.log(`  sent: ${filteredResult.sent}, total: ${filteredResult.total}`);
if (filteredResult.total < 2) {
  throw new Error(`Expected both CLI-registered test agents to match, got ${filteredResult.total}`);
}
ok('actorType=agent filter matched both test agents', filteredResult.total);

// Step 6: Skills filter with no matches
log('6/6', 'Skills filter with no matching agents');
const noMatchResult = await broadcast('Skill-targeted update', 'For quantum-computing agents.', {
  skills: ['quantum-computing-xyz-no-match'],
});
console.log(`  sent: ${noMatchResult.sent}, total: ${noMatchResult.total}`);
if (noMatchResult.total !== 0) {
  throw new Error(`Expected zero matches for unused skill, got ${noMatchResult.total}`);
}
ok('skills filter with no matching agents', noMatchResult.total);

console.log('\n=== smoke-broadcast PASSED ===');

/**
 * Email smoke test: exercises the full email stack against a running backend.
 *
 * Steps:
 *  1. Register two devices (agent A and agent B)
 *  2. Register email addresses for both agents
 *  3. Duplicate register rejected with CONFLICT
 *  4. A sends email to B's @taskmarket address (internal routing)
 *  5. B lists inbox; verifies email appears and is unread
 *  6. B reads email; verifies isRead becomes true
 *  7. B marks email unread via markRead
 *  8. B replies to A; A verifies reply appears in inbox
 *  9. B deletes email; verifies inbox is empty
 *
 * Usage:
 *   API_URL=http://localhost:3000 npx tsx --env-file=../../.env scripts/smoke-email.ts
 */
import { randomBytes } from 'crypto';
import { log, ok, get, post, API_URL } from './_x402';

function randomAddress(): string {
  return '0x' + randomBytes(20).toString('hex');
}

async function registerDevice(walletAddress: string): Promise<{ deviceId: string; apiToken: string }> {
  const result = (await post('/api/devices', { walletAddress })) as {
    deviceId: string;
    apiToken: string;
  };
  return result;
}

async function main() {
  console.log('=== Taskmarket Smoke Test — Email ===');
  console.log('api:', API_URL);

  const addrA = randomAddress();
  const addrB = randomAddress();

  // 1. Register devices
  log('1', 'Registering devices for agents A and B...');
  const devA = await registerDevice(addrA);
  const devB = await registerDevice(addrB);
  ok('device A', devA.deviceId);
  ok('device B', devB.deviceId);

  // 2. Register email addresses
  log('2', 'Registering email addresses...');
  const usernameA = `smoke-a-${randomBytes(4).toString('hex')}`;
  const usernameB = `smoke-b-${randomBytes(4).toString('hex')}`;

  const regA = (await post('/api/emails/register', {
    deviceId: devA.deviceId,
    apiToken: devA.apiToken,
    username: usernameA,
  })) as { emailAddress: string };
  ok('email A', regA.emailAddress);

  const regB = (await post('/api/emails/register', {
    deviceId: devB.deviceId,
    apiToken: devB.apiToken,
    username: usernameB,
  })) as { emailAddress: string };
  ok('email B', regB.emailAddress);

  // 3. Duplicate register rejected with CONFLICT
  log('3', 'Verifying duplicate register is rejected...');
  const dupRes = await fetch(`${API_URL}/api/emails/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId: devA.deviceId,
      apiToken: devA.apiToken,
      username: 'anything',
    }),
  });
  if (dupRes.status !== 409) {
    throw new Error(`Expected 409 CONFLICT, got ${dupRes.status}`);
  }
  ok('duplicate register rejected', dupRes.status);

  // 4. A sends email to B (internal routing)
  log('4', `A sends email to B (${regB.emailAddress})...`);
  const sendResult = (await post('/api/emails/send', {
    deviceId: devA.deviceId,
    apiToken: devA.apiToken,
    to: regB.emailAddress,
    subject: 'Hello from A',
    bodyText: 'Hi B, this is A!',
  })) as { sent: boolean };
  if (!sendResult.sent) throw new Error('Expected sent: true');
  ok('send result', sendResult.sent);

  // 5. B lists inbox
  log('5', 'B lists inbox...');
  const listParams = new URLSearchParams({
    deviceId: devB.deviceId,
    apiToken: devB.apiToken,
    limit: '10',
  });
  const listResult = (await get(`/api/emails/list?${listParams}`)) as {
    emails: Array<{ id: string; fromAddress: string; subject: string; isRead: boolean }>;
  };
  if (listResult.emails.length === 0) throw new Error('Expected at least 1 email in inbox');
  const email = listResult.emails[0];
  ok('inbox count', listResult.emails.length);
  ok('email from', email.fromAddress);
  ok('email subject', email.subject);
  if (email.isRead) throw new Error('Expected isRead: false on new email');
  ok('isRead', email.isRead);

  // 6. B reads email (auto-marks read)
  log('6', 'B reads email...');
  const readParams = new URLSearchParams({
    deviceId: devB.deviceId,
    apiToken: devB.apiToken,
    id: email.id,
  });
  const readResult = (await get(
    `/api/emails/get?${readParams}`
  )) as { isRead: boolean; bodyText: string };
  if (!readResult.isRead) throw new Error('Expected isRead: true after read');
  ok('isRead after get', readResult.isRead);
  ok('bodyText', readResult.bodyText);

  // 7. B marks email unread
  log('7', 'B marks email unread...');
  const markResult = (await post('/api/emails/mark-read', {
    deviceId: devB.deviceId,
    apiToken: devB.apiToken,
    id: email.id,
    read: false,
  })) as { id: string; isRead: boolean };
  if (markResult.isRead) throw new Error('Expected isRead: false after markRead(false)');
  ok('isRead after mark-unread', markResult.isRead);

  // 8. B replies to A
  log('8', 'B replies to A...');
  const replyResult = (await post('/api/emails/send', {
    deviceId: devB.deviceId,
    apiToken: devB.apiToken,
    to: regA.emailAddress,
    subject: 'Re: Hello from A',
    bodyText: 'Hi A, got your message!',
  })) as { sent: boolean };
  if (!replyResult.sent) throw new Error('Expected sent: true on reply');
  ok('reply sent', replyResult.sent);

  // Verify A has the reply in inbox
  const aListParams = new URLSearchParams({
    deviceId: devA.deviceId,
    apiToken: devA.apiToken,
    limit: '10',
  });
  const aListResult = (await get(`/api/emails/list?${aListParams}`)) as {
    emails: Array<{ id: string; subject: string }>;
  };
  if (aListResult.emails.length === 0) throw new Error('Expected reply in A inbox');
  ok('reply in A inbox', aListResult.emails[0].subject);

  // 9. B deletes email
  log('9', 'B deletes email...');
  const deleteResult = (await post('/api/emails/delete', {
    deviceId: devB.deviceId,
    apiToken: devB.apiToken,
    id: email.id,
  })) as { deleted: boolean };
  if (!deleteResult.deleted) throw new Error('Expected deleted: true');
  ok('deleted', deleteResult.deleted);

  const emptyListResult = (await get(`/api/emails/list?${listParams}`)) as {
    emails: unknown[];
  };
  if (emptyListResult.emails.length !== 0) {
    throw new Error(`Expected empty inbox after delete, got ${emptyListResult.emails.length}`);
  }
  ok('inbox empty after delete', true);

  console.log('\n=== Email smoke test passed ===');
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

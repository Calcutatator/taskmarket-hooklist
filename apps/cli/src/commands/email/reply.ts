import { Command } from 'commander';
import { loadKeystore } from '../../lib/keystore.js';
import { apiGet, apiPost } from '../../lib/api.js';
import { printResult } from '../../lib/output.js';

export const replyCommand = new Command('reply')
  .description('Reply to an email')
  .argument('<id>', 'Email ID to reply to')
  .requiredOption('--body <text>', 'Reply body text')
  .action(async (id: string, opts: { body: string }) => {
    const keystore = await loadKeystore();

    const params = new URLSearchParams({
      deviceId: keystore.deviceId,
      apiToken: keystore.apiToken,
      id,
    });
    const original = (await apiGet(`/api/emails/get?${params.toString()}`)) as {
      fromAddress: string;
      subject: string | null;
    };

    const to = original.fromAddress;
    const rawSubject = original.subject ?? '';
    const subject = rawSubject.startsWith('Re: ') ? rawSubject : `Re: ${rawSubject}`;

    const { data: result, idempotencyKey } = await apiPost<{ sent: boolean }>('/api/emails/send', {
      deviceId: keystore.deviceId,
      apiToken: keystore.apiToken,
      to,
      subject,
      bodyText: opts.body,
    });

    printResult({ sent: result.sent }, { idempotencyKey });
  });

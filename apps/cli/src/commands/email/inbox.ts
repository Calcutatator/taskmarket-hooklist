import { Command } from 'commander';
import { loadKeystore } from '../../lib/keystore.js';
import { apiGet } from '../../lib/api.js';
import { printResult } from '../../lib/output.js';

export const inboxCommand = new Command('inbox')
  .description('List emails in your inbox')
  .option('--limit <n>', 'Number of emails to return', '20')
  .option('--unread', 'Show only unread emails')
  .action(async (opts: { limit: string; unread?: boolean }) => {
    const keystore = await loadKeystore();
    const params = new URLSearchParams({
      deviceId: keystore.deviceId,
      apiToken: keystore.apiToken,
      limit: opts.limit,
    });
    if (opts.unread) {
      params.set('unread', 'true');
    }
    const result = (await apiGet(`/api/emails/list?${params.toString()}`)) as {
      emails: unknown[];
    };
    printResult({ emails: result.emails });
  });

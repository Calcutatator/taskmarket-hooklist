import { Command } from 'commander';
import { loadKeystore } from '../../lib/keystore.js';
import { apiPost } from '../../lib/api.js';
import { printResult } from '../../lib/output.js';

export const sendCommand = new Command('send')
  .description('Send an email')
  .requiredOption('--to <address>', 'Recipient email address')
  .requiredOption('--subject <subject>', 'Email subject')
  .requiredOption('--body <text>', 'Email body text')
  .action(async (opts: { to: string; subject: string; body: string }) => {
    const keystore = await loadKeystore();
    const result = (await apiPost('/api/emails/send', {
      deviceId: keystore.deviceId,
      apiToken: keystore.apiToken,
      to: opts.to,
      subject: opts.subject,
      bodyText: opts.body,
    })) as { sent: boolean };
    printResult({ sent: result.sent });
  });

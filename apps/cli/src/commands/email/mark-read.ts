import { Command } from 'commander';
import { loadKeystore } from '../../lib/keystore.js';
import { apiPost } from '../../lib/api.js';
import { printResult } from '../../lib/output.js';

async function setReadStatus(id: string, read: boolean): Promise<void> {
  const keystore = await loadKeystore();
  const result = (await apiPost('/api/emails/mark-read', {
    deviceId: keystore.deviceId,
    apiToken: keystore.apiToken,
    id,
    read,
  })) as { id: string; isRead: boolean };
  printResult({ id: result.id, isRead: result.isRead });
}

export const markReadCommand = new Command('mark-read')
  .description('Mark an email as read or unread')
  .argument('<id>', 'Email ID')
  .option('--unread', 'Mark as unread instead of read')
  .action(async (id: string, opts: { unread?: boolean }) => {
    await setReadStatus(id, !opts.unread);
  });

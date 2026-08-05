import { Command } from 'commander';
import { loadKeystore } from '../../lib/keystore.js';
import { apiPost } from '../../lib/api.js';
import { printResult } from '../../lib/output.js';

async function setReadStatus(id: string, read: boolean): Promise<void> {
  const keystore = await loadKeystore();
  const { data: result, idempotencyKey } = await apiPost<{ id: string; isRead: boolean }>(
    '/api/emails/mark-read',
    {
      deviceId: keystore.deviceId,
      apiToken: keystore.apiToken,
      id,
      read,
    }
  );
  printResult({ id: result.id, isRead: result.isRead }, { idempotencyKey });
}

export const markReadCommand = new Command('mark-read')
  .description('Mark an email as read or unread')
  .argument('<id>', 'Email ID')
  .option('--unread', 'Mark as unread instead of read')
  .action(async (id: string, opts: { unread?: boolean }) => {
    await setReadStatus(id, !opts.unread);
  });

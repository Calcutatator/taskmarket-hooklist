import { Command } from 'commander';
import { loadKeystore } from '../../lib/keystore.js';
import { apiPost } from '../../lib/api.js';
import { printResult } from '../../lib/output.js';

export const deleteCommand = new Command('delete')
  .description('Delete an email by ID')
  .argument('<id>', 'Email ID')
  .action(async (id: string) => {
    const keystore = await loadKeystore();
    const result = (await apiPost('/api/emails/delete', {
      deviceId: keystore.deviceId,
      apiToken: keystore.apiToken,
      id,
    })) as { deleted: boolean };
    printResult({ deleted: result.deleted });
  });

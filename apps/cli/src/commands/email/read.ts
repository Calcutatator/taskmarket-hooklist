import { Command } from 'commander';
import { loadKeystore } from '../../lib/keystore.js';
import { apiGet } from '../../lib/api.js';
import { printResult } from '../../lib/output.js';

export const readCommand = new Command('read')
  .description('Read an email by ID (marks it as read)')
  .argument('<id>', 'Email ID')
  .action(async (id: string) => {
    const keystore = await loadKeystore();
    const params = new URLSearchParams({
      deviceId: keystore.deviceId,
      apiToken: keystore.apiToken,
      id,
    });
    const result = (await apiGet(`/api/emails/get?${params.toString()}`)) as unknown;
    printResult(result);
  });

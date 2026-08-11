import { Command } from 'commander';
import { loadKeystore } from '../../lib/keystore.js';
import { apiGet, apiPost } from '../../lib/api.js';
import { printResult, printError } from '../../lib/output.js';

export const registerCommand = new Command('register')
  .description('Register an email address for this agent')
  .requiredOption('--username <name>', 'Desired username (e.g. myagent)')
  .action(async (opts: { username: string }) => {
    // Fail-fast: check availability before loading keystore
    const check = (await apiGet(
      `/api/emails/check-username?username=${encodeURIComponent(opts.username)}`
    )) as { available: boolean };
    if (!check.available) {
      printError(`Username "${opts.username}" is not available.`);
      return;
    }

    const keystore = await loadKeystore();
    const { data: result, idempotencyKey } = await apiPost<{ emailAddress: string }>(
      '/api/emails/register',
      {
        deviceId: keystore.deviceId,
        apiToken: keystore.apiToken,
        username: opts.username,
      }
    );

    printResult({ emailAddress: result.emailAddress }, { idempotencyKey });
  });

import { Command } from 'commander';
import { apiGet } from '../lib/api.js';
import { getWalletAddress } from '../lib/signer.js';
import { printResult, printError } from '../lib/output.js';

interface TaskRow {
  id: string;
  description: string;
  reward: string;
  mode: string;
  status: string;
  tags: string[];
}

interface InboxResult {
  asRequester: TaskRow[];
  asWorker: TaskRow[];
}

export const inboxCommand = new Command('inbox')
  .description('Show tasks you created and tasks you are working on')
  .action(async () => {
    let address: string;
    try {
      address = await getWalletAddress();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'No keystore found. Run `taskmarket init` first.';
      printError(msg);
    }

    const result = (await apiGet(
      `/api/agents/inbox?address=${encodeURIComponent(address!)}`
    )) as InboxResult;
    printResult(result);
  });

import { Command } from 'commander';
import { apiGet } from '../lib/api.js';
import { getWalletAddress } from '../lib/signer.js';
import { isHumanMode, printResult, printError } from '../lib/output.js';

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

function formatTaskLine(task: TaskRow): void {
  const desc =
    task.description.length > 60 ? task.description.slice(0, 57) + '...' : task.description;
  const reward = (Number(task.reward) / 1e6).toFixed(3);
  const tags = task.tags.length > 0 ? task.tags.join(', ') : '-';

  console.log(`  ${task.id.slice(0, 10)}...  ${desc}`);
  console.log(`    Reward: ${reward} USDC | Mode: ${task.mode} | Status: ${task.status}`);
  console.log(`    Tags: ${tags}`);
}

export const inboxCommand = new Command('inbox')
  .description('Show tasks you created and tasks you are working on')
  .option('--human', 'Human-readable output')
  .action(async (opts: { human?: boolean }) => {
    const human = isHumanMode(opts.human);

    let address: string;
    try {
      address = await getWalletAddress();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'No keystore found. Run `taskmarket init` first.';
      printError(msg, human);
    }

    const result = (await apiGet(
      `/api/agents/inbox?address=${encodeURIComponent(address!)}`
    )) as InboxResult;

    if (!human) {
      printResult(result, human);
      return;
    }

    console.log('\n=== Tasks Created (requester) ===');
    if (result.asRequester.length === 0) {
      console.log('  (none)');
    } else {
      for (const task of result.asRequester) {
        formatTaskLine(task);
      }
    }

    console.log('\n=== Tasks Working On (worker) ===');
    if (result.asWorker.length === 0) {
      console.log('  (none)');
    } else {
      for (const task of result.asWorker) {
        formatTaskLine(task);
      }
    }
  });

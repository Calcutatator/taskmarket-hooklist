import { Command } from 'commander';
import { apiGet } from '../../lib/api.js';
import { isHumanMode, printResult, printError } from '../../lib/output.js';

type Submission = {
  id: string;
  taskId: string;
  workerAddress: string;
  fileUrl: string;
  submittedAt: string;
  workerAgentId: string | null;
  workerStats: {
    completedTasks: number;
    ratedTasks: number;
    totalStars: number;
    averageRating: number;
  };
};

export const submissionsCmd = new Command('submissions')
  .description('List submissions for a task')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .option('--human', 'Human-readable output')
  .action(async (taskId: string, opts: { human?: boolean }) => {
    const human = isHumanMode(opts.human);

    let subs: Submission[];
    try {
      subs = (await apiGet(`/api/tasks/${taskId}/submissions`)) as Submission[];
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch submissions.';
      printError(msg, human);
    }

    if (!human) {
      printResult(subs!, human);
      return;
    }

    if (subs!.length === 0) {
      console.log('No submissions yet.');
      return;
    }

    console.log(`Found ${subs!.length} submission(s):\n`);
    for (const s of subs!) {
      console.log(`  ID:      ${s.id}`);
      const agentSuffix = s.workerAgentId ? ` (agent ${s.workerAgentId})` : '';
      console.log(`  Worker:  ${s.workerAddress}${agentSuffix}`);
      console.log(`  File:    ${s.fileUrl}`);
      console.log(`  At:      ${s.submittedAt}`);
      if (s.workerStats.ratedTasks > 0) {
        const avg = s.workerStats.averageRating.toFixed(1);
        console.log(`  Rating:  ${avg} (${s.workerStats.ratedTasks} rated tasks)`);
      }
      console.log('');
    }

    console.log(`To accept: taskmarket task accept ${taskId} --worker <address>`);
  });

import { Command } from 'commander';
import { apiGet } from '../../lib/api.js';
import { isHumanMode, printResult } from '../../lib/output.js';

interface TaskRow {
  id: string;
  description: string;
  reward: string;
  mode: string;
  status: string;
  tags: string[];
}

export const listCmd = new Command('list')
  .alias('search')
  .description('List available tasks')
  .option('--status <status>', 'Filter by status (e.g. open)', 'open')
  .option('--mode <mode>', 'Filter by mode (bounty, claim, pitch, benchmark, auction)')
  .option('--tags <tags>', 'Comma-separated tags to filter by')
  .option('--skill <skill>', 'Filter by skill tag (comma-separated, alias for --tags)')
  .option('--reward-min <n>', 'Minimum reward in USDC')
  .option('--reward-max <n>', 'Maximum reward in USDC')
  .option('--deadline-hours <n>', 'Only tasks expiring within this many hours')
  .option('--limit <n>', 'Maximum results to return', '20')
  .option('--human', 'Human-readable output')
  .action(
    async (opts: {
      status?: string;
      mode?: string;
      tags?: string;
      skill?: string;
      rewardMin?: string;
      rewardMax?: string;
      deadlineHours?: string;
      limit?: string;
      human?: boolean;
    }) => {
      const human = isHumanMode(opts.human);
      const params = new URLSearchParams();
      if (opts.status) params.set('status', opts.status);
      if (opts.mode) params.set('mode', opts.mode);
      const tagsValue = opts.tags ?? opts.skill;
      if (tagsValue) params.set('tags', tagsValue);
      if (opts.rewardMin)
        params.set('minReward', String(Math.round(Number(opts.rewardMin) * 1_000_000)));
      if (opts.rewardMax)
        params.set('maxReward', String(Math.round(Number(opts.rewardMax) * 1_000_000)));
      if (opts.deadlineHours) params.set('deadlineHours', opts.deadlineHours);
      if (opts.limit) params.set('limit', opts.limit);

      const result = (await apiGet(`/api/tasks?${params.toString()}`)) as {
        tasks: TaskRow[];
        hasMore: boolean;
      };

      if (!human) {
        printResult({ tasks: result.tasks, hasMore: result.hasMore }, human);
        return;
      }

      if (result.tasks.length === 0) {
        console.log('No tasks found.');
        return;
      }

      console.log(
        `Found ${result.tasks.length} task(s)${result.hasMore ? ' (more available)' : ''}:\n`
      );
      for (const task of result.tasks) {
        const desc =
          task.description.length > 60 ? task.description.slice(0, 57) + '...' : task.description;
        console.log(`  ${task.id}`);
        console.log(`    ${desc}`);
        console.log(
          `    Reward: ${Number(task.reward) / 1e6} USDC | Mode: ${task.mode} | Status: ${task.status}`
        );
        if (task.tags.length > 0) {
          console.log(`    Tags: ${task.tags.join(', ')}`);
        }
        console.log('');
      }
    }
  );

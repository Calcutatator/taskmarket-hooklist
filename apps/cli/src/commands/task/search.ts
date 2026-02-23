import { Command } from 'commander';
import { apiGet } from '../../lib/api.js';

interface TaskRow {
  id: string;
  description: string;
  reward: string;
  mode: string;
  status: string;
  tags: string[];
}

export const searchCmd = new Command('search')
  .description('Search available tasks')
  .option('--status <status>', 'Filter by status (e.g. open)', 'open')
  .option('--mode <mode>', 'Filter by mode (bounty, claim, pitch, benchmark, auction)')
  .option('--tags <tags>', 'Comma-separated tags to filter by')
  .option('--limit <n>', 'Maximum results to return', '20')
  .action(async (opts: { status?: string; mode?: string; tags?: string; limit?: string }) => {
    const params = new URLSearchParams();
    if (opts.status) params.set('status', opts.status);
    if (opts.mode) params.set('mode', opts.mode);
    if (opts.tags) params.set('tags', opts.tags);
    if (opts.limit) params.set('limit', opts.limit);

    const result = (await apiGet(`/api/tasks?${params.toString()}`)) as {
      tasks: TaskRow[];
      hasMore: boolean;
    };

    if (result.tasks.length === 0) {
      console.log('No tasks found.');
      return;
    }

    console.log(`Found ${result.tasks.length} task(s)${result.hasMore ? ' (more available)' : ''}:\n`);
    for (const task of result.tasks) {
      const desc = task.description.length > 60
        ? task.description.slice(0, 57) + '...'
        : task.description;
      console.log(`  ${task.id}`);
      console.log(`    ${desc}`);
      console.log(`    Reward: ${Number(task.reward) / 1e6} USDC | Mode: ${task.mode} | Status: ${task.status}`);
      if (task.tags.length > 0) {
        console.log(`    Tags: ${task.tags.join(', ')}`);
      }
      console.log('');
    }
  });

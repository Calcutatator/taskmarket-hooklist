import { Command } from 'commander';
import { apiGet } from '../../lib/api.js';
import { printResult } from '../../lib/output.js';

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
  .option(
    '--phase <phase>',
    'Filter by derived lifecycle phase (active, in_review, awaiting_settlement, resolved) -- ' +
      'independent of --status, e.g. --phase awaiting_settlement finds tasks whose deadline ' +
      'has passed but are still open/claimed/worker_selected'
  )
  .option('--mode <mode>', 'Filter by mode (bounty, claim, pitch, benchmark, auction)')
  .option(
    '--auction-type <type>',
    'Filter auction tasks by subtype (dutch, english, reverse_dutch, reverse_english)'
  )
  .option('--tags <tags>', 'Comma-separated tags to filter by')
  .option('--skill <skill>', 'Filter by skill tag (comma-separated, alias for --tags)')
  .option('--reward-min <n>', 'Minimum reward in USDC')
  .option('--reward-max <n>', 'Maximum reward in USDC')
  .option('--deadline-hours <n>', 'Only tasks expiring within this many hours')
  .option('--limit <n>', 'Maximum results to return', '20')
  .option('--cursor <cursor>', 'Cursor from previous page (nextCursor in JSON output)')
  .action(
    async (opts: {
      status?: string;
      phase?: string;
      mode?: string;
      auctionType?: string;
      tags?: string;
      skill?: string;
      rewardMin?: string;
      rewardMax?: string;
      deadlineHours?: string;
      limit?: string;
      cursor?: string;
    }) => {
      const params = new URLSearchParams();
      if (opts.status) params.set('status', opts.status);
      if (opts.phase) params.set('phase', opts.phase);
      if (opts.mode) params.set('mode', opts.mode);
      if (opts.auctionType) params.set('auctionType', opts.auctionType);
      const tagsValue = opts.tags ?? opts.skill;
      if (tagsValue) params.set('tags', tagsValue);
      if (opts.rewardMin)
        params.set('minReward', String(Math.round(Number(opts.rewardMin) * 1_000_000)));
      if (opts.rewardMax)
        params.set('maxReward', String(Math.round(Number(opts.rewardMax) * 1_000_000)));
      if (opts.deadlineHours) params.set('deadlineHours', opts.deadlineHours);
      if (opts.limit) params.set('limit', opts.limit);
      if (opts.cursor) params.set('cursor', opts.cursor);

      const result = (await apiGet(`/api/tasks?${params.toString()}`)) as {
        tasks: TaskRow[];
        hasMore: boolean;
        nextCursor: string | null;
      };
      printResult({ tasks: result.tasks, hasMore: result.hasMore, nextCursor: result.nextCursor });
    }
  );

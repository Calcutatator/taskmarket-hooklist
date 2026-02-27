import { Command } from 'commander';
import { apiGet } from '../lib/api.js';
import { printResult } from '../lib/output.js';

export const agentsCommand = new Command('agents')
  .description('Browse the agent directory')
  .option('--sort <order>', 'Sort order: reputation or tasks', 'reputation')
  .option('--skill <tag>', 'Filter by skill tag')
  .option('--search <query>', 'Search by agentId or wallet address')
  .option('--limit <n>', 'Maximum results to return', '20')
  .action(async (opts: { sort?: string; skill?: string; search?: string; limit?: string }) => {
    const params = new URLSearchParams();
    if (opts.sort) params.set('sort', opts.sort);
    if (opts.skill) params.set('skill', opts.skill);
    if (opts.search) params.set('search', opts.search);
    if (opts.limit) params.set('limit', opts.limit);

    const result = await apiGet(`/api/agents/leaderboard?${params.toString()}`);
    printResult(result);
  });

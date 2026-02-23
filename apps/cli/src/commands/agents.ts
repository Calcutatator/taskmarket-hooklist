import { Command } from 'commander';
import { apiGet } from '../lib/api.js';
import { isHumanMode, printResult } from '../lib/output.js';

interface AgentRow {
  rank: number;
  address: string;
  agentId: string | null;
  completedTasks: number;
  averageRating: number;
  totalEarnings: string;
  skills: string[];
}

export const agentsCommand = new Command('agents')
  .description('Browse the agent directory')
  .option('--sort <order>', 'Sort order: reputation or tasks', 'reputation')
  .option('--skill <tag>', 'Filter by skill tag')
  .option('--search <query>', 'Search by agentId or wallet address')
  .option('--limit <n>', 'Maximum results to return', '20')
  .option('--human', 'Human-readable output')
  .action(
    async (opts: {
      sort?: string;
      skill?: string;
      search?: string;
      limit?: string;
      human?: boolean;
    }) => {
      const human = isHumanMode(opts.human);
      const params = new URLSearchParams();
      if (opts.sort) params.set('sort', opts.sort);
      if (opts.skill) params.set('skill', opts.skill);
      if (opts.search) params.set('search', opts.search);
      if (opts.limit) params.set('limit', opts.limit);

      const result = (await apiGet(`/api/agents/leaderboard?${params.toString()}`)) as AgentRow[];

      if (!human) {
        printResult(result, human);
        return;
      }

      if (!result || result.length === 0) {
        console.log('No agents found.');
        return;
      }

      const header = [
        'Rank'.padEnd(5),
        'Agent ID'.padEnd(12),
        'Address'.padEnd(14),
        'Tasks'.padStart(6),
        'Rating'.padStart(7),
        'Earned (USDC)'.padStart(14),
        'Skills',
      ].join('  ');

      console.log(header);
      console.log('-'.repeat(header.length));

      for (const agent of result) {
        const rank = `#${agent.rank}`.padEnd(5);
        const agentId = (agent.agentId ?? '-').slice(0, 10).padEnd(12);
        const addr = `${agent.address.slice(0, 6)}...${agent.address.slice(-4)}`.padEnd(14);
        const tasks = String(agent.completedTasks).padStart(6);
        const rating =
          agent.averageRating > 0 ? agent.averageRating.toFixed(1).padStart(7) : '    N/A';
        const earned = (Number(agent.totalEarnings) / 1e6).toFixed(3).padStart(14);
        const skills = agent.skills.length > 0 ? agent.skills.join(', ') : '-';

        console.log([rank, agentId, addr, tasks, rating, earned, skills].join('  '));
      }
    }
  );

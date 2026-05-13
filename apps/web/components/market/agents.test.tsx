import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AgentLeaderboardPanel, AgentProfilePanel, AgentTable } from './agents';

const entry = {
  rank: 1,
  address: '0x1111111111111111111111111111111111111111',
  agentId: 'summarizer.bot',
  completedTasks: 7,
  averageRating: 4.8,
  totalEarnings: '120000000',
  skills: ['research', 'summary'],
};

describe('Agent components', () => {
  it('renders leaderboard/profile links and ranking data', () => {
    render(<AgentTable agents={[entry]} />);
    expect(screen.getByRole('link', { name: /summarizer.bot/i })).toHaveAttribute(
      'href',
      '/dashboard/agents/summarizer.bot'
    );
    expect(screen.getByText('4.8')).toBeInTheDocument();
    expect(screen.getByText('120.000 USDC')).toBeInTheDocument();
  });

  it('renders leaderboard filters, sort links, earnings, and pagination parity controls', () => {
    render(
      <AgentLeaderboardPanel
        agents={[entry]}
        hasNextPage
        hasPrevPage
        minRating="4"
        minTasks="5"
        page={2}
        pageSize={20}
        search="sum"
        skill="research"
        sort="tasks"
      />
    );

    expect(screen.getByText('Ranking filters')).toBeInTheDocument();
    expect(screen.getByLabelText(/search/i)).toHaveValue('sum');
    expect(screen.getByLabelText(/skill/i)).toHaveValue('research');
    expect(screen.getByLabelText(/min rating/i)).toHaveValue('4');
    expect(screen.getByLabelText(/min tasks/i)).toHaveValue('5');
    expect(screen.getByLabelText(/per page/i)).toHaveValue('20');
    expect(screen.getByRole('link', { name: /reputation/i })).toHaveAttribute(
      'href',
      '/dashboard/leaderboard?sort=reputation&search=sum&skill=research&page=1&limit=20&minRating=4&minTasks=5'
    );
    expect(screen.getByRole('link', { name: /previous/i })).toHaveAttribute(
      'href',
      '/dashboard/leaderboard?sort=tasks&search=sum&skill=research&page=1&limit=20&minRating=4&minTasks=5'
    );
    expect(screen.getByRole('link', { name: /next/i })).toHaveAttribute(
      'href',
      '/dashboard/leaderboard?sort=tasks&search=sum&skill=research&page=3&limit=20&minRating=4&minTasks=5'
    );
    expect(screen.getByRole('link', { name: /clear filters/i })).toHaveAttribute(
      'href',
      '/dashboard/leaderboard?sort=tasks&limit=20'
    );
  });

  it('uses leaderboard-specific worker labels and empty copy', () => {
    render(
      <AgentLeaderboardPanel
        agents={[]}
        hasNextPage={false}
        hasPrevPage={false}
        page={1}
        pageSize={20}
        sort="reputation"
      />
    );

    expect(screen.getByText('No workers found.')).toBeInTheDocument();
  });

  it('renders a profile summary for a known agent', () => {
    render(<AgentProfilePanel agent={entry} />);
    expect(screen.getByRole('heading', { name: /summarizer.bot/i })).toBeInTheDocument();
    expect(screen.getByText(/7 completed tasks/i)).toBeInTheDocument();
    expect(screen.getByText('Identity record')).toBeInTheDocument();
    expect(screen.getByText('CLI commands')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /view address on basescan/i }).getAttribute('href')
    ).toMatch(/basescan\.org\/address\/0x1111111111111111111111111111111111111111$/);
    expect(screen.getByRole('button', { name: /copy address/i })).toBeVisible();
    expect(
      screen.getByText('taskmarket stats --address 0x1111111111111111111111111111111111111111')
    ).toBeInTheDocument();
  });

  it('adds task context to recent agent ratings when available', () => {
    render(
      <AgentProfilePanel
        agent={{
          ...entry,
          ratedTasks: 1,
          totalStars: 96,
          recentRatings: [
            {
              createdAt: '2026-01-01T00:00:00.000Z',
              feedbackText: 'Accurate reconciliation with clear evidence.',
              rating: 96,
              taskId: 'task-with-review',
              taskTitle: 'Audit settlement receipts',
            },
          ],
        }}
      />
    );

    expect(screen.getByText('Audit settlement receipts')).toBeInTheDocument();
    expect(screen.getByText(/Accurate reconciliation with clear evidence/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open reviewed task/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks/task-with-review'
    );
  });
});

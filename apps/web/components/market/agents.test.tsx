import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentLeaderboardPanel, AgentProfilePanel, AgentTable } from './agents';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    children: React.ReactNode;
    href: string;
  }) => (
    <a data-next-link="true" href={href} {...props}>
      {children}
    </a>
  ),
}));

// The agent profile mounts AgentPerformanceChart, a trpc consumer. Stub the query
// so the panel renders without a tRPC provider; it echoes any seeded initialData.
vi.mock('@/lib/api/client', () => ({
  trpc: {
    stats: {
      agentTimeSeries: {
        useQuery: (_input: unknown, options?: { initialData?: unknown }) => ({
          data: options?.initialData ?? [],
          dataUpdatedAt: 0,
          isError: false,
          isLoading: false,
        }),
      },
    },
  },
}));

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
    const profileLinks = screen.getAllByRole('link', { name: /summarizer.bot/i });
    expect(profileLinks.length).toBeGreaterThan(0);
    for (const link of profileLinks) {
      expect(link).toHaveAttribute('href', '/dashboard/agents/summarizer.bot');
      expect(link).toHaveAttribute('data-next-link', 'true');
    }
    expect(screen.getAllByText('4.8').length).toBeGreaterThan(0);
    expect(screen.getAllByText('120 USDC').length).toBeGreaterThan(0);
  });

  it('renders both a desktop table and a mobile card list for the directory', () => {
    const { container } = render(<AgentTable agents={[entry]} />);

    const desktopTable = container.querySelector('.hidden.md\\:block table');
    expect(desktopTable).not.toBeNull();

    const mobileList = container.querySelector('ul.md\\:hidden');
    expect(mobileList).not.toBeNull();
  });

  it('links mobile cards to the agent profile with the encoded id', () => {
    const encodedEntry = { ...entry, agentId: 'space agent', address: entry.address };
    const { container } = render(<AgentTable agents={[encodedEntry]} profileBasePath="/agents" />);

    const mobileList = container.querySelector('ul.md\\:hidden');
    expect(mobileList).not.toBeNull();
    const mobileLink = mobileList?.querySelector('a[href^="/agents/"]');
    expect(mobileLink).not.toBeNull();
    expect(mobileLink).toHaveAttribute('href', '/agents/space%20agent');
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

  it('renders a back-to-directory link using the default directory base path', () => {
    render(<AgentProfilePanel agent={entry} />);
    expect(screen.getByRole('link', { name: /back to agents/i })).toHaveAttribute(
      'href',
      '/dashboard/agents'
    );
  });

  it('renders a back-to-directory link using a custom directory base path', () => {
    render(<AgentProfilePanel agent={entry} directoryBasePath="/agents" taskBasePath="/tasks" />);
    expect(screen.getByRole('link', { name: /back to agents/i })).toHaveAttribute(
      'href',
      '/agents'
    );
  });

  it('links to tasks worked by this agent using the default task base path', () => {
    render(<AgentProfilePanel agent={entry} />);
    expect(screen.getByRole('link', { name: /tasks worked by this agent/i })).toHaveAttribute(
      'href',
      `/dashboard/tasks?worker=${encodeURIComponent(entry.address)}`
    );
  });

  it('links to tasks worked by this agent using a custom task base path', () => {
    render(<AgentProfilePanel agent={entry} directoryBasePath="/agents" taskBasePath="/tasks" />);
    expect(screen.getByRole('link', { name: /tasks worked by this agent/i })).toHaveAttribute(
      'href',
      `/tasks?worker=${encodeURIComponent(entry.address)}`
    );
  });

  it('exposes an accessible tooltip description for the ERC-8004 identity', () => {
    render(<AgentProfilePanel agent={entry} />);
    const triggers = screen.getAllByRole('button', { name: /what is erc-8004/i });
    expect(triggers.length).toBeGreaterThan(0);
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

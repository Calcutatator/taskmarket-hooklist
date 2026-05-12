import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LeaderboardEntry, TaskResponse } from '@taskmarket/shared';
import { LandingPageContent } from './landing';

vi.mock('@/lib/api/client', () => ({
  trpc: {
    tasks: {
      list: {
        useQuery: (_input: unknown, options?: { initialData?: unknown }) => ({
          data: options?.initialData,
        }),
      },
    },
  },
}));

const liveTask: TaskResponse = {
  auctionBidCount: 3,
  auctionType: 'english',
  bidDeadline: null,
  claimedAt: null,
  claimedBy: null,
  createdAt: new Date().toISOString(),
  currentLowestBid: '790000000',
  description: 'Build a typed parser for agent capability manifests.',
  escrowTxHash: '0xreference2',
  expiryTime: new Date(Date.now() + 86_400_000).toISOString(),
  id: 'live-auction',
  maxPrice: null,
  metricDescription: null,
  metricTarget: null,
  mode: 'auction',
  platformFeeBps: 250,
  pitchCount: 1,
  pitchDeadline: null,
  rating: null,
  requester: '0x597b0e7F366D9f985E03C8BdaF014C96a5985e4B',
  requesterPubkey: '0x597b0e7F366D9f985E03C8BdaF014C96a5985e4B',
  reward: '850000000',
  stakeBps: 0,
  stakeRequired: false,
  status: 'open',
  submissionCount: 2,
  tags: ['typescript', 'agents'],
  worker: null,
};

const topAgents: LeaderboardEntry[] = [
  {
    address: '0x1111111111111111111111111111111111111111',
    agentId: 'agent-alpha',
    averageRating: 4.8,
    completedTasks: 28,
    emailAddress: 'agent-alpha@example.com',
    rank: 1,
    skills: ['typescript', 'analysis'],
    totalEarnings: '1825000000',
  },
  {
    address: '0x2222222222222222222222222222222222222222',
    agentId: null,
    averageRating: 4.5,
    completedTasks: 17,
    emailAddress: null,
    rank: 2,
    skills: ['solidity', 'testing'],
    totalEarnings: '940000000',
  },
];

function renderLanding(props?: {
  agentCount?: number;
  taskCount?: number;
  tasks?: TaskResponse[];
  topAgents?: LeaderboardEntry[];
  totalRewards?: string;
}) {
  return render(
    <LandingPageContent
      stats={{
        agentCount: props?.agentCount ?? 4,
        taskCount: props?.taskCount ?? 12,
        totalRewards: props?.totalRewards ?? '25000000',
      }}
      tasks={props?.tasks ?? []}
      topAgents={props?.topAgents}
    />
  );
}

describe('LandingPageContent', () => {
  it('links the navbar and primary buyer actions into market destinations', () => {
    const { container } = renderLanding();

    const header = container.querySelector('header');
    const primaryNav = screen.getByRole('navigation', { name: /primary/i });

    expect(header).not.toBeNull();
    expect(screen.getByRole('link', { name: /taskmarket/i })).toHaveAttribute('href', '/');
    expect(within(primaryNav).getByRole('link', { name: /^tasks$/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks'
    );
    expect(within(primaryNav).getByRole('link', { name: /^agents$/i })).toHaveAttribute(
      'href',
      '/dashboard/agents'
    );
    expect(within(primaryNav).getByRole('link', { name: /^protocol$/i })).toHaveAttribute(
      'href',
      '/dashboard/protocol'
    );
    expect(
      within(header as HTMLElement).getByRole('link', { name: /^dashboard$/i })
    ).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('link', { name: /^post a funded task$/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks/new'
    );
    expect(screen.getByRole('link', { name: /^watch open market$/i })).toHaveAttribute(
      'href',
      '#live-market-pulse'
    );
    expect(
      screen.getByText(
        /escrow usdc once, route the brief across autonomous workers, compare bids, pitches, proofs, and submissions live/i
      )
    ).toBeVisible();
    expect(
      screen.getAllByText('curl -fsSL https://taskmarket.example/skill.md -o skill.md').length
    ).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /copy skill install command/i }).length).toBe(2);
    expect(screen.queryByRole('link', { name: /read protocol/i })).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="hero-dotted-wave"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="hero-compute-exchange"]')).toBeInTheDocument();
  });

  it('renders buyer-first hero stats and a compute exchange visual', () => {
    const { container } = renderLanding({ tasks: [liveTask] });

    const heroHeading = screen.getByRole('heading', {
      name: /fund one task\. unleash a market of agents\./i,
    });
    const heroSection = heroHeading.closest('section');
    const exchange = container.querySelector('[data-testid="hero-compute-exchange"]');
    const heroStats = container.querySelector('[data-testid="hero-market-stats"]');

    expect(heroSection).not.toBeNull();
    expect(exchange).not.toBeNull();
    expect(heroStats).not.toBeNull();
    expect(within(heroStats as HTMLElement).getByText(/^Open tasks$/i)).toBeVisible();
    expect(within(heroStats as HTMLElement).getByText(/^12$/i)).toBeVisible();
    expect(within(heroStats as HTMLElement).getByText(/^Registered agents$/i)).toBeVisible();
    expect(within(heroStats as HTMLElement).getByText(/^4$/i)).toBeVisible();
    expect(within(heroStats as HTMLElement).getByText(/^Funded volume$/i)).toBeVisible();
    expect(within(heroStats as HTMLElement).getByText(/^25\.000 USDC$/i)).toBeVisible();
    expect(within(exchange as HTMLElement).getByText(/^Buyer brief$/i)).toBeVisible();
    expect(within(exchange as HTMLElement).getByText(/^Agent lanes$/i)).toBeVisible();
    expect(within(exchange as HTMLElement).getByText(/^Accepted receipt$/i)).toBeVisible();
    expect(within(exchange as HTMLElement).getByText(/^Logo design$/i)).toBeVisible();
    expect(within(exchange as HTMLElement).getByText('2.000 USDC')).toBeVisible();
    expect(within(exchange as HTMLElement).getByText(/^100$/i)).toBeVisible();
    expect(within(exchange as HTMLElement).getByText(/^bids$/i)).toBeVisible();
    expect(within(exchange as HTMLElement).getByText(/^agents submitted bids$/i)).toBeVisible();
    expect(within(exchange as HTMLElement).getByText(/^2$/i)).toBeVisible();
    expect(within(exchange as HTMLElement).getByText(/^submissions$/i)).toBeVisible();
    expect(exchange).toHaveAttribute('data-animate', 'compute-exchange');
    expect(container.querySelectorAll('[data-exchange-card]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-agent-lane]')).toHaveLength(4);
    expect(container.querySelector('[data-agent-lane="bids"]')).toHaveClass(
      'task-market-agent-lane--bids'
    );
  });

  it('adds motion orchestration to the hero copy and landing sections', () => {
    const { container } = renderLanding({ tasks: [liveTask] });

    expect(container.querySelector('[data-motion="landing-hero-copy"]')).toBeInTheDocument();
    expect(container.querySelector('[data-motion="landing-hero-title"]')).toContainElement(
      screen.getByRole('heading', {
        name: /fund one task\. unleash a market of agents\./i,
      })
    );
    expect(container.querySelector('[data-motion="landing-hero-actions"]')).toBeInTheDocument();
    expect(container.querySelector('[data-motion="landing-hero-install"]')).toBeInTheDocument();
    expect(container.querySelector('[data-motion="landing-section-pulse"]')).toBeInTheDocument();
    expect(
      container.querySelector('[data-motion="landing-section-mechanics"]')
    ).toBeInTheDocument();
    expect(container.querySelector('[data-motion="landing-section-supply"]')).toBeInTheDocument();
    expect(container.querySelector('[data-motion="landing-section-actions"]')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-motion^="landing-section-"]')).toHaveLength(4);
  });

  it('puts the live market terminal directly after the hero', () => {
    const { container } = renderLanding({ tasks: [liveTask], totalRewards: '4250000000' });

    const pageSections = Array.from(container.querySelectorAll('section'));
    const hero = pageSections[0];
    const liveMarketSection = pageSections[1];

    expect(hero).toContainElement(
      screen.getByRole('heading', {
        name: /fund one task\. unleash a market of agents\./i,
      })
    );
    expect(liveMarketSection).toContainElement(
      screen.getByRole('heading', { name: /live funded work/i })
    );
    expect(within(liveMarketSection as HTMLElement).getByText(/^market terminal$/i)).toBeVisible();
    expect(
      within(liveMarketSection as HTMLElement).getByText(
        /counts and rewards refresh every fifteen seconds/i
      )
    ).toBeVisible();
    expect(
      within(liveMarketSection as HTMLElement).getByRole('link', {
        name: /build a typed parser for agent capability manifests/i,
      })
    ).toHaveAttribute('href', '/dashboard/tasks/live-auction');
    expect(within(liveMarketSection as HTMLElement).getByText('850.000 USDC')).toBeVisible();
    expect(within(liveMarketSection as HTMLElement).getByText(/english auction/i)).toBeVisible();
    expect(within(liveMarketSection as HTMLElement).getByText(/^typescript$/i)).toBeVisible();
    expect(within(liveMarketSection as HTMLElement).getByText(/0x597b\.\.\.5e4B/i)).toBeVisible();
    expect(
      within(liveMarketSection as HTMLElement).getByRole('tab', { name: /all/i })
    ).toBeVisible();
    expect(
      within(liveMarketSection as HTMLElement).getByRole('tab', { name: /auction/i })
    ).toBeVisible();
  });

  it('renders buyer mechanics and agent supply sections', () => {
    renderLanding({ tasks: [liveTask], topAgents });

    expect(screen.getByRole('heading', { name: /choose the market mechanic/i })).toBeVisible();
    expect(screen.getByText(/pick bounty when you want many attempts/i)).toBeVisible();
    expect(screen.getByRole('link', { name: /compare task modes/i })).toHaveAttribute(
      'href',
      '/dashboard/task-types'
    );
    expect(screen.getByRole('heading', { name: /humans bring the agents/i })).toBeVisible();
    const supplySection = screen
      .getByRole('heading', { name: /humans bring the agents/i })
      .closest('section');

    expect(supplySection).not.toBeNull();
    expect(
      screen.getByText(/agent owners connect workers that can earn from funded buyer demand/i)
    ).toBeVisible();
    expect(screen.getByText(/^agent-alpha$/i)).toBeVisible();
    expect(screen.getByText('1,825.000 USDC')).toBeVisible();
    expect(
      within(supplySection as HTMLElement).getByText(
        'curl -fsSL https://taskmarket.example/skill.md -o skill.md'
      )
    ).toBeVisible();
    expect(screen.getByRole('link', { name: /connect an agent to jobs/i })).toHaveAttribute(
      'href',
      '/dashboard/for-agents'
    );
  });

  it('finishes with a buyer-dominant action section and landing footer links', () => {
    renderLanding({ tasks: [liveTask] });

    expect(screen.getByRole('heading', { name: /post the outcome/i })).toBeVisible();
    expect(screen.getByText(/^Post the outcome\.$/i)).toBeVisible();
    expect(screen.getByText(/^Bring an agent\.$/i)).toBeVisible();
    expect(screen.queryByRole('heading', { name: /choose your path/i })).not.toBeInTheDocument();

    const footer = screen.getByRole('contentinfo');

    expect(within(footer).getByRole('link', { name: /browse tasks/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks'
    );
    expect(within(footer).getByRole('link', { name: /skill\.md/i })).toHaveAttribute(
      'href',
      '/skill.md'
    );
    expect(within(footer).getByRole('link', { name: /open task console/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks'
    );
    expect(
      within(footer).getByRole('link', { name: /made by daydreams\.systems/i })
    ).toHaveAttribute('href', 'https://daydreams.systems');
    expect(within(footer).getByRole('img', { name: /base blockchain logo/i })).toBeVisible();
    expect(within(footer).getByRole('img', { name: /usdc logo/i })).toBeVisible();
    expect(within(footer).getByText(/fund work\. route agents\. settle receipts\./i)).toBeVisible();
  });

  it('renders a direct empty market state when no live tasks exist', () => {
    renderLanding({
      agentCount: 0,
      taskCount: 0,
      tasks: [],
      totalRewards: '0',
    });

    expect(screen.getByRole('heading', { name: /live funded work/i })).toBeVisible();
    expect(screen.getByText(/no open tasks right now/i)).toBeVisible();
    expect(screen.queryByText(/sample snapshot/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/example data/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no open tasks yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no tasks found/i)).not.toBeInTheDocument();
    expect(screen.getByText(/^Post the outcome\.$/i)).toBeVisible();
    expect(screen.getByText(/^Bring an agent\.$/i)).toBeVisible();
  });
});

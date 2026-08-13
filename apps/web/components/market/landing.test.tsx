import { render, screen, within } from '@testing-library/react';
import { getAgentName } from '@taskmarket/shared';
import { describe, expect, it, vi } from 'vitest';
import type { LeaderboardEntry, TaskResponse } from '@taskmarket/shared';
import { LandingPageContent } from './landing';

vi.mock('@/lib/api/client', () => ({
  trpc: {
    submissions: {
      // TaskThumbnail (mounted for live-pulse tasks with submissions) calls this; return
      // no submissions so the thumbnail hides itself and the landing renders as before.
      listByTask: {
        useQuery: () => ({ data: [] }),
      },
    },
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
  requester: '0x597b0e7F366D9f985E03C8BdaF014C96a5985e4B',
  requesterPubkey: '0x597b0e7F366D9f985E03C8BdaF014C96a5985e4B',
  reward: '850000000',
  stakeBps: 0,
  stakeRequired: false,
  status: 'open',
  submissionCount: 2,
  submissionWindowOpen: true,
  phase: 'active',
  tags: ['typescript', 'agents'],
  taskVisibility: 'public',
  submissionVisibility: 'public',
};

const topAgents: LeaderboardEntry[] = [
  {
    address: '0x1111111111111111111111111111111111111111',
    agentId: '4201',
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
  it('links both sides of the hero into their market destinations', () => {
    const { container } = renderLanding();

    // The shared navbar/header now lives in the public route-group layout, not
    // in LandingPageContent.
    expect(container.querySelector('header')).toBeNull();
    expect(screen.queryByRole('navigation', { name: /primary/i })).not.toBeInTheDocument();
    const heroPostAction = container.querySelector(
      '[data-motion="landing-hero-action-post"]'
    ) as HTMLElement;
    expect(within(heroPostAction).getByRole('link', { name: /^post a task$/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks/new'
    );
    const heroBrowseAction = container.querySelector(
      '[data-motion="landing-hero-action-browse"]'
    ) as HTMLElement;
    expect(within(heroBrowseAction).getByRole('link', { name: /^browse work$/i })).toHaveAttribute(
      'href',
      '/live'
    );
    expect(
      screen.getByText(
        /fund tasks and choose the best result, or put your agents to work and earn usdc/i
      )
    ).toBeVisible();
    expect(
      screen.getAllByText(
        'npx skills add https://github.com/daydreamsai/skills-market --skill taskmarket'
      ).length
    ).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /copy npx skill install command/i }).length).toBe(
      2
    );
    expect(
      container.querySelector(
        '[data-testid="landing-market-loop"] [data-slot="skill-install-snippet"]'
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /read protocol/i })).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="hero-dotted-wave"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="landing-market-loop"]')).toBeInTheDocument();
  });

  it('places live proof with the audience it serves', () => {
    const { container } = renderLanding({ tasks: [liveTask] });

    const heroHeading = screen.getByRole('heading', {
      name: /get work done\. 12 tasks open for agents\./i,
    });
    const heroSection = heroHeading.closest('section');
    const buyerProof = container.querySelector('[data-testid="landing-buyer-card-proof"]');
    const agentProof = container.querySelector('[data-testid="landing-agent-card-proof"]');
    const skillRail = container.querySelector('[data-testid="landing-market-skill"]');

    expect(heroSection).not.toBeNull();
    expect(buyerProof).not.toBeNull();
    expect(agentProof).not.toBeNull();
    expect(skillRail).not.toBeNull();
    expect(heroSection).toContainElement(buyerProof as HTMLElement);
    expect(heroSection).toContainElement(agentProof as HTMLElement);
    expect(heroSection).toContainElement(skillRail as HTMLElement);
    expect(within(skillRail as HTMLElement).getByText(/^Add the Taskmarket skill$/i)).toBeVisible();
    expect(within(buyerProof as HTMLElement).getByText(/^Registered agents$/i)).toBeVisible();
    expect(within(buyerProof as HTMLElement).getByLabelText('4')).toBeVisible();
    expect(within(agentProof as HTMLElement).getByText(/^Funded volume$/i)).toBeVisible();
    expect(within(agentProof as HTMLElement).getByLabelText('25.00')).toBeVisible();
    expect(within(agentProof as HTMLElement).getByText(/^USDC$/i)).toBeVisible();
    expect(
      within(buyerProof as HTMLElement).getByRole('link', {
        name: /view registered agents in dashboard/i,
      })
    ).toHaveAttribute('href', '/dashboard/agents');
    expect(
      within(agentProof as HTMLElement).getByRole('link', {
        name: /view funded volume in dashboard/i,
      })
    ).toHaveAttribute('href', '/dashboard?section=activity');
    expect(screen.queryByText(/^Logo design$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^pricing the work$/i)).not.toBeInTheDocument();
  });

  it('adds motion orchestration to the hero copy and landing sections', () => {
    const { container } = renderLanding({ tasks: [liveTask] });

    expect(container.querySelector('[data-motion="landing-hero-copy"]')).toBeInTheDocument();
    expect(container.querySelector('[data-motion="landing-hero-title"]')).toContainElement(
      screen.getByRole('heading', {
        name: /get work done\. 12 tasks open for agents\./i,
      })
    );
    expect(container.querySelector('[data-motion="landing-hero-actions"]')).toBeInTheDocument();
    expect(container.querySelector('[data-motion="landing-hero-diagram"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="landing-market-skill"]')).toBeInTheDocument();
    expect(container.querySelector('[data-motion="landing-section-why"]')).toBeInTheDocument();
    expect(
      container.querySelector('[data-motion="landing-section-mechanics"]')
    ).toBeInTheDocument();
    expect(container.querySelector('[data-motion="landing-section-pulse"]')).toBeInTheDocument();
    expect(container.querySelector('[data-motion="landing-section-supply"]')).toBeInTheDocument();
    expect(
      container.querySelector('[data-motion="landing-section-final-cta"]')
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-motion="landing-section-actions"]')
    ).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-motion^="landing-section-"]')).toHaveLength(5);
  });

  it('orders sections hero → why → mechanics → live pulse → supply', () => {
    const liveTasks = Array.from({ length: 6 }, (_, index) => ({
      ...liveTask,
      description: `${liveTask.description} ${index + 1}`,
      id: `${liveTask.id}-${index + 1}`,
    }));
    const { container } = renderLanding({ tasks: liveTasks, totalRewards: '4250000000' });

    const pageSections = Array.from(container.querySelectorAll('section'));
    const [hero, whySection, mechanicsSection, liveMarketSection, supplySection] = pageSections;

    expect(hero).toContainElement(
      screen.getByRole('heading', {
        name: /get work done\. 12 tasks open for agents\./i,
      })
    );
    expect(whySection).toContainElement(
      screen.getByRole('heading', {
        name: /tap a swarm of expert agents the moment you need work shipped/i,
      })
    );
    expect(mechanicsSection).toContainElement(
      screen.getByRole('heading', { name: /choose the market mechanic/i })
    );
    expect(liveMarketSection).toContainElement(
      screen.getByRole('heading', { name: /live funded work/i })
    );
    expect(
      within(liveMarketSection as HTMLElement).getByTestId('live-tetris-background')
    ).toBeInTheDocument();
    const taskList = within(liveMarketSection as HTMLElement).getByTestId('live-market-task-list');
    const taskCards = within(taskList).getAllByTestId('live-market-task-card');

    expect(taskList).toHaveClass('grid-cols-1');
    expect(taskList).not.toHaveClass('sm:grid-cols-2');
    expect(taskCards).toHaveLength(4);
    for (const card of taskCards) {
      expect(card).not.toHaveAttribute('style');
    }
    expect(supplySection).toContainElement(
      screen.getByRole('heading', { name: /release your agents\. get paid per result\./i })
    );
    expect(
      within(liveMarketSection as HTMLElement).getByRole('heading', {
        name: /live funded work/i,
      })
    ).toHaveClass('text-center');
    expect(
      within(liveMarketSection as HTMLElement).queryByText(/^market terminal$/i)
    ).not.toBeInTheDocument();
    expect(
      within(liveMarketSection as HTMLElement).getByText(
        /counts and rewards refresh every fifteen seconds/i
      )
    ).toBeVisible();
    expect(
      within(taskCards[0] as HTMLElement).getByRole('link', {
        name: /build a typed parser for agent capability manifests\. 1/i,
      })
    ).toHaveAttribute('href', '/tasks/live-auction-1');
    expect(within(taskCards[0] as HTMLElement).getByText('850 USDC')).toBeVisible();
    expect(within(taskCards[0] as HTMLElement).getByText(/english auction/i)).toBeVisible();
    expect(within(taskCards[0] as HTMLElement).getByText(/^typescript$/i)).toBeVisible();
    expect(within(taskCards[0] as HTMLElement).getByText(/0x597b\.\.\.5e4B/i)).toBeVisible();
    expect(
      within(liveMarketSection as HTMLElement).queryByRole('tab', { name: /all/i })
    ).not.toBeInTheDocument();
    expect(
      within(liveMarketSection as HTMLElement).queryByRole('tab', { name: /auction/i })
    ).not.toBeInTheDocument();
  });

  it('frames the page with a standalone Burst compute section before mechanics', () => {
    const { container } = renderLanding({ tasks: [liveTask] });

    const whyHeading = screen.getByRole('heading', {
      name: /tap a swarm of expert agents the moment you need work shipped/i,
    });
    const whySection = whyHeading.closest('section');
    const mechanicsSection = screen
      .getByRole('heading', { name: /choose the market mechanic/i })
      .closest('section');

    expect(whySection).not.toBeNull();
    expect(mechanicsSection).not.toBeNull();
    expect(whySection).not.toBe(mechanicsSection);
    expect(within(whySection as HTMLElement).getByText(/^Burst compute$/i)).toBeVisible();
    expect(
      within(whySection as HTMLElement).getByText(
        /taskmarket turns a funded task into burst compute/i
      )
    ).toBeVisible();
    expect(
      within(mechanicsSection as HTMLElement).queryByText(/^Burst compute$/i)
    ).not.toBeInTheDocument();
    expect(within(mechanicsSection as HTMLElement).getByText(/^01$/i)).toBeVisible();
    expect(within(mechanicsSection as HTMLElement).getByText(/^Fund the outcome$/i)).toBeVisible();
    expect(within(mechanicsSection as HTMLElement).getByText(/^Accept and pay$/i)).toBeVisible();
    const taskTypeDescriptions = [
      'Use bounty when many workers attempt work and one result is paid out',
      'Use claim when one worker reserves the task before solo work begins.',
      'Use pitch when workers propose plans before any delivery work begins',
      'Use benchmark when measured proof decides which result gets paid out',
      'Use auction when workers compete on price, timing, or allocation fit',
    ];

    expect(screen.getByText(taskTypeDescriptions[0])).toBeVisible();
    expect(new Set(taskTypeDescriptions.map((description) => description.length))).toEqual(
      new Set([68])
    );
    expect(container.querySelector('[data-task-mode-card="bounty"] img')?.getAttribute('src')).toBe(
      '/bid.png'
    );
    expect(container.querySelector('[data-task-mode-card="claim"] img')?.getAttribute('src')).toBe(
      '/claim.png'
    );
    expect(container.querySelector('[data-task-mode-card="pitch"] img')?.getAttribute('src')).toBe(
      '/pitch.png'
    );
    expect(
      container.querySelector('[data-task-mode-card="benchmark"] img')?.getAttribute('src')
    ).toBe('/benchmark.png');
    expect(
      container.querySelector('[data-task-mode-card="auction"] img')?.getAttribute('src')
    ).toBe('/auction.png');
    expect(screen.queryByRole('link', { name: /compare task modes/i })).not.toBeInTheDocument();
    expect(
      within(mechanicsSection as HTMLElement).getByRole('link', { name: /^post a task$/i })
    ).toHaveAttribute('href', '/dashboard/tasks/new');
  });

  it('renders the agent supply section with skill snippet and leaderboard', () => {
    renderLanding({ tasks: [liveTask], topAgents });

    const supplySection = screen
      .getByRole('heading', { name: /release your agents\. get paid per result\./i })
      .closest('section');

    expect(supplySection).not.toBeNull();
    const supplySectionElement = supplySection as HTMLElement;
    const skillCopy = within(supplySectionElement).getByTestId('agent-supply-skill-copy');
    const supplySteps = within(supplySectionElement).getByTestId('agent-supply-steps');

    expect(skillCopy.compareDocumentPosition(supplySteps)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      within(supplySectionElement).getByText(
        /wire any agent into the marketplace\. bid, claim, and ship funded work/i
      )
    ).toBeVisible();
    expect(within(supplySectionElement).getByText(/^install the skill$/i)).toBeVisible();
    expect(within(supplySectionElement).getByText(/^connect to jobs$/i)).toBeVisible();
    expect(within(supplySectionElement).getByText(/^get paid in usdc$/i)).toBeVisible();
    expect(within(supplySectionElement).queryByText(/^design agents$/i)).not.toBeInTheDocument();
    expect(
      within(supplySectionElement).getByRole('img', { name: /usdc coin logo/i })
    ).toHaveAttribute('src', '/usdc-token.svg');
    expect(
      within(supplySectionElement).getByRole('img', { name: /base network logo/i })
    ).toHaveAttribute('src', '/base-network.svg');
    expect(within(supplySectionElement).getByText(/^coming soon$/i)).toBeVisible();
    expect(within(supplySectionElement).getByText(/^ethereum$/i)).toBeVisible();
    expect(within(supplySectionElement).getByText(/^optimism$/i)).toBeVisible();
    expect(within(supplySectionElement).getByText(/^arbitrum$/i)).toBeVisible();
    expect(within(supplySectionElement).getByText(/^polygon$/i)).toBeVisible();
    expect(screen.getByText(getAgentName('4201') as string)).toBeVisible();
    expect(screen.getByText('1,825 USDC')).toBeVisible();
    expect(
      within(supplySectionElement).getByText(
        'npx skills add https://github.com/daydreamsai/skills-market --skill taskmarket'
      )
    ).toBeVisible();
    expect(
      within(supplySectionElement).getByRole('link', { name: /^start earning$/i })
    ).toHaveAttribute('href', '/dashboard/for-agents');
    expect(
      within(supplySectionElement).getByRole('link', { name: /see full leaderboard/i })
    ).toHaveAttribute('href', '/leaderboard');
    expect(
      within(supplySectionElement).getByRole('link', { name: /view agent leaderboard/i })
    ).toHaveAttribute('href', '/agents');
  });

  it('drops the duplicate action section and delegates the footer to the layout', () => {
    renderLanding({ tasks: [liveTask] });

    expect(screen.queryByRole('heading', { name: /post the outcome/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Post the outcome\.$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Bring an agent\.$/i)).not.toBeInTheDocument();

    // The shared footer now lives in the public route-group layout, so
    // LandingPageContent no longer renders its own contentinfo region.
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/fund work\. route agents\. settle receipts\./i)
    ).not.toBeInTheDocument();
  });

  it('renders a direct empty market state when no live tasks exist', () => {
    const { container } = renderLanding({
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

    const liveSection = screen
      .getByRole('heading', { name: /live funded work/i })
      .closest('section');

    expect(liveSection).not.toBeNull();
    expect(liveSection?.className).not.toMatch(/min-h-\[100dvh\]/);
    expect(
      container.querySelector('[data-testid="hero-compute-exchange"]')
    ).not.toBeInTheDocument();
  });
});

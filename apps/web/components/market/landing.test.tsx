import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TaskResponse } from '@taskmarket/shared';
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

describe('LandingPageContent', () => {
  it('links the navbar and primary landing actions into market destinations', () => {
    const { container } = render(
      <LandingPageContent
        stats={{
          agentCount: 4,
          taskCount: 12,
          totalRewards: '25000000',
        }}
        tasks={[]}
      />
    );

    const header = container.querySelector('header');
    const primaryNav = screen.getByRole('navigation', { name: /primary/i });

    expect(header).not.toBeNull();
    expect(screen.getByRole('link', { name: /taskmarket/i })).toHaveAttribute('href', '/');
    expect(within(primaryNav).getByRole('link', { name: /^tasks$/i })).toHaveAttribute(
      'href',
      '/tasks'
    );
    expect(within(primaryNav).getByRole('link', { name: /^agents$/i })).toHaveAttribute(
      'href',
      '/agents'
    );
    expect(within(primaryNav).getByRole('link', { name: /^protocol$/i })).toHaveAttribute(
      'href',
      '/protocol'
    );
    expect(
      within(header as HTMLElement).getByRole('link', { name: /^dashboard$/i })
    ).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('link', { name: /^post a task$/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks/new'
    );
    expect(screen.getByRole('link', { name: /^browse open work$/i })).toHaveAttribute(
      'href',
      '/tasks'
    );
    expect(
      screen.getByText(
        /taskmarket is a marketplace for paid autonomous-agent work: requesters fund verifiable tasks in usdc/i
      )
    ).toBeVisible();
    expect(
      screen.getByText('curl -fsSL https://taskmarket.example/skill.md -o skill.md')
    ).toBeVisible();
    expect(screen.getByRole('button', { name: /copy skill install command/i })).toBeVisible();
    expect(screen.queryByRole('link', { name: /read protocol/i })).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="hero-market-diagram"]')).toBeInTheDocument();
  });

  it('renders visible market stats and a product diagram in the hero', () => {
    const { container } = render(
      <LandingPageContent
        stats={{
          agentCount: 4,
          taskCount: 12,
          totalRewards: '25000000',
        }}
        tasks={[liveTask]}
      />
    );

    const heroHeading = screen.getByRole('heading', {
      name: /escrow tasks\. agents compete\. winners get paid\./i,
    });
    const heroSection = heroHeading.closest('section');
    const heroDiagram = container.querySelector('[data-testid="hero-market-diagram"]');
    const heroStats = container.querySelector('[data-testid="hero-market-stats"]');

    expect(heroSection).not.toBeNull();
    expect(heroDiagram).not.toBeNull();
    expect(heroStats).not.toBeNull();
    expect(within(heroStats as HTMLElement).getByText(/^Open tasks$/i)).toBeVisible();
    expect(within(heroStats as HTMLElement).getByText(/^12$/i)).toBeVisible();
    expect(within(heroStats as HTMLElement).getByText(/^Agents$/i)).toBeVisible();
    expect(within(heroStats as HTMLElement).getByText(/^4$/i)).toBeVisible();
    expect(within(heroStats as HTMLElement).getByText(/^Posted volume$/i)).toBeVisible();
    expect(within(heroStats as HTMLElement).getByText(/^25\.000 USDC$/i)).toBeVisible();
    expect(within(heroDiagram as HTMLElement).getByText(/^Funded task$/i)).toBeVisible();
    expect(within(heroDiagram as HTMLElement).getByText(/^Competing agents$/i)).toBeVisible();
    expect(within(heroDiagram as HTMLElement).getByText(/^Accepted receipt$/i)).toBeVisible();
    expect(within(heroDiagram as HTMLElement).getByText('850.000 USDC')).toBeVisible();
    expect(heroDiagram).toHaveAttribute('data-animate', 'market-flow');
    expect(container.querySelectorAll('[data-flow-card]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-flow-connector]')).toHaveLength(2);
  });

  it('adds motion orchestration to the hero copy and landing sections', () => {
    const { container } = render(
      <LandingPageContent
        stats={{
          agentCount: 4,
          taskCount: 12,
          totalRewards: '25000000',
        }}
        tasks={[liveTask]}
      />
    );

    expect(container.querySelector('[data-motion="landing-hero-copy"]')).toBeInTheDocument();
    expect(container.querySelector('[data-motion="landing-hero-title"]')).toContainElement(
      screen.getByRole('heading', {
        name: /escrow tasks\. agents compete\. winners get paid\./i,
      })
    );
    expect(container.querySelector('[data-motion="landing-hero-actions"]')).toBeInTheDocument();
    expect(container.querySelector('[data-motion="landing-hero-install"]')).toBeInTheDocument();
    expect(container.querySelector('[data-motion="landing-section-burst"]')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-motion^="landing-section-"]')).toHaveLength(3);
  });

  it('renders burst compute as the second landing section', () => {
    const { container } = render(
      <LandingPageContent
        stats={{
          agentCount: 4,
          taskCount: 12,
          totalRewards: '25000000',
        }}
        tasks={[liveTask]}
      />
    );

    const pageSections = Array.from(container.querySelectorAll('section'));
    const hero = pageSections[0];
    const burstSection = pageSections[1];

    expect(hero).toContainElement(
      screen.getByRole('heading', {
        name: /escrow tasks\. agents compete\. winners get paid\./i,
      })
    );
    expect(burstSection).toContainElement(
      screen.getByRole('heading', {
        name: /one funded brief becomes a competitive work market\./i,
      })
    );
    expect(
      within(burstSection as HTMLElement).getByText(/taskmarket turns a task into a small market/i)
    ).toBeVisible();
    expect(within(burstSection as HTMLElement).getByText(/^01 Fund$/i)).toBeVisible();
    expect(
      within(burstSection as HTMLElement).getByText(/escrow usdc behind a precise outcome/i)
    ).toBeVisible();
    expect(within(burstSection as HTMLElement).getByText(/^02 Route$/i)).toBeVisible();
    expect(
      within(burstSection as HTMLElement).getByText(/choose bounty, claim, pitch/i)
    ).toBeVisible();
    expect(within(burstSection as HTMLElement).getByText(/^03 Compete$/i)).toBeVisible();
    expect(
      within(burstSection as HTMLElement).getByText(/agents bid, claim, pitch/i)
    ).toBeVisible();
    expect(within(burstSection as HTMLElement).getByText(/^04 Settle$/i)).toBeVisible();
    expect(
      within(burstSection as HTMLElement).getByText(/accepted work releases payment/i)
    ).toBeVisible();
    expect(within(burstSection as HTMLElement).getByText(/^Requester value$/i)).toBeVisible();
    expect(within(burstSection as HTMLElement).getByText(/^Agent value$/i)).toBeVisible();
    expect(within(burstSection as HTMLElement).getByText(/^Protocol value$/i)).toBeVisible();
    expect(within(burstSection as HTMLElement).getByText(/Mode choices/i)).toBeVisible();
    expect(
      within(burstSection as HTMLElement).queryByText(/^funded task$/i)
    ).not.toBeInTheDocument();
    expect(
      within(burstSection as HTMLElement).queryByText(/^best receipt$/i)
    ).not.toBeInTheDocument();
    expect(
      within(burstSection as HTMLElement).queryByText(/^variable pool$/i)
    ).not.toBeInTheDocument();
    expect(within(burstSection as HTMLElement).queryByText(/100x/i)).not.toBeInTheDocument();
  });

  it('renders the landing footer with market and protocol links', () => {
    render(
      <LandingPageContent
        stats={{
          agentCount: 4,
          taskCount: 12,
          totalRewards: '25000000',
        }}
        tasks={[]}
      />
    );

    const footer = screen.getByRole('contentinfo');

    expect(within(footer).getByRole('link', { name: /browse tasks/i })).toHaveAttribute(
      'href',
      '/tasks'
    );
    expect(within(footer).getByRole('link', { name: /skill\.md/i })).toHaveAttribute(
      'href',
      '/skill.md'
    );
    expect(within(footer).getByRole('link', { name: /open task console/i })).toHaveAttribute(
      'href',
      '/dashboard/tasks'
    );
    expect(within(footer).getByText(/post work\. accept work\. settle receipts\./i)).toBeVisible();
  });

  it('renders split below-fold sections from open task data', () => {
    render(
      <LandingPageContent
        stats={{
          agentCount: 8,
          taskCount: 18,
          totalRewards: '4250000000',
        }}
        tasks={[liveTask]}
      />
    );

    const liveMarketHeading = screen.getByRole('heading', { name: /open work, streaming/i });
    const liveMarketSection = liveMarketHeading.closest('section');

    expect(liveMarketHeading).toBeVisible();
    expect(liveMarketSection).not.toBeNull();
    expect(screen.getByRole('heading', { name: /choose your path/i })).toBeVisible();
    expect(
      screen.getByRole('heading', {
        name: /one funded brief becomes a competitive work market\./i,
      })
    ).toBeVisible();
    expect(screen.queryByRole('heading', { name: /market in action/i })).not.toBeInTheDocument();
    expect(screen.getByText(/^live market pulse$/i)).toBeVisible();
    expect(
      screen.getByRole('link', { name: /build a typed parser for agent capability manifests/i })
    ).toHaveAttribute('href', '/dashboard/tasks/live-auction');
    expect(within(liveMarketSection as HTMLElement).getByText('850.000 USDC')).toBeVisible();
    expect(screen.getByText(/english auction/i)).toBeVisible();
    expect(within(liveMarketSection as HTMLElement).getByText(/^3$/i)).toBeInTheDocument();
    expect(within(liveMarketSection as HTMLElement).getByText(/^bids$/i)).toBeVisible();
    expect(within(liveMarketSection as HTMLElement).getByText(/^2$/i)).toBeInTheDocument();
    expect(within(liveMarketSection as HTMLElement).getByText(/^subs$/i)).toBeVisible();
    expect(screen.getByText(/0x597b\.\.\.5e4B/i)).toBeVisible();
    expect(screen.getByRole('tab', { name: /all/i })).toBeVisible();
    expect(screen.getByRole('tab', { name: /auction/i })).toBeVisible();
    expect(screen.getByText(/^post work\.$/i)).toBeVisible();
    expect(screen.getByText(/^find work\.$/i)).toBeVisible();
  });

  it('renders an explicitly labeled sample flow when no live tasks exist', () => {
    render(
      <LandingPageContent
        stats={{
          agentCount: 0,
          taskCount: 0,
          totalRewards: '0',
        }}
        tasks={[]}
      />
    );

    expect(screen.getByRole('heading', { name: /open work, streaming/i })).toBeVisible();
    expect(screen.getByText(/no open tasks right now/i)).toBeVisible();
    expect(screen.queryByText(/sample snapshot/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/example data/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no open tasks yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no tasks found/i)).not.toBeInTheDocument();
    expect(screen.getByText(/^post work\.$/i)).toBeVisible();
    expect(screen.getByText(/^find work\.$/i)).toBeVisible();
  });
});

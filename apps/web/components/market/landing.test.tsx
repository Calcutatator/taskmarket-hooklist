import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TaskResponse } from '@taskmarket/shared';
import { LandingPageContent } from './landing';

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
    expect(screen.getByRole('link', { name: /open dashboard/i })).toHaveAttribute(
      'href',
      '/dashboard'
    );
    expect(
      screen
        .getAllByRole('link', { name: /browse tasks/i })
        .some((link) => link.getAttribute('href') === '/dashboard/tasks')
    ).toBe(true);
    expect(
      screen.getByText('curl -fsSL https://taskmarket.example/skill.md -o skill.md')
    ).toBeVisible();
    expect(screen.getByRole('button', { name: /copy skill install command/i })).toBeVisible();
    expect(screen.queryByRole('link', { name: /read protocol/i })).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="task-market-hero-grid"]')).toHaveAttribute(
      'aria-hidden',
      'true'
    );
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

    expect(screen.getByRole('heading', { name: /live market snapshot/i })).toBeVisible();
    expect(screen.getByRole('heading', { name: /why this market works/i })).toBeVisible();
    expect(screen.getByRole('heading', { name: /how the market moves/i })).toBeVisible();
    expect(screen.getByRole('heading', { name: /pick the right mode/i })).toBeVisible();
    expect(screen.getByRole('heading', { name: /choose your path/i })).toBeVisible();
    expect(screen.queryByRole('heading', { name: /market in action/i })).not.toBeInTheDocument();
    expect(screen.getByText(/^live market$/i)).toBeVisible();
    expect(screen.queryByText(/sample market flow/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /build a typed parser for agent capability manifests/i })
    ).toHaveAttribute('href', '/dashboard/tasks/live-auction');
    expect(screen.getByText('850.000 USDC')).toBeVisible();
    expect(screen.getByText(/english auction/i)).toBeVisible();
    expect(screen.getByText(/3 bids/i)).toBeVisible();
    expect(screen.getByText(/2 submissions/i)).toBeVisible();
    expect(screen.getByText(/0x597b\.\.\.5e4B/i)).toBeVisible();
    expect(screen.getByText(/^post funded task$/i)).toBeVisible();
    expect(screen.getByText(/^agents compete$/i)).toBeVisible();
    expect(screen.getByText(/^review output$/i)).toBeVisible();
    expect(screen.getByText(/^settle usdc$/i)).toBeVisible();
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

    expect(screen.getByRole('heading', { name: /live market snapshot/i })).toBeVisible();
    expect(screen.getByText(/sample snapshot/i)).toBeVisible();
    expect(screen.getByText(/example data/i)).toBeVisible();
    expect(screen.queryByText(/no open tasks yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no tasks found/i)).not.toBeInTheDocument();
    expect(screen.getByText(/^post funded task$/i)).toBeVisible();
    expect(screen.getByText(/^agents compete$/i)).toBeVisible();
    expect(screen.getByText(/^review output$/i)).toBeVisible();
    expect(screen.getByText(/^settle usdc$/i)).toBeVisible();
  });
});

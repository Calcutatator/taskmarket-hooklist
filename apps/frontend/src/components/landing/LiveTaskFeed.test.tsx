import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TaskResponse } from '@taskmarket/shared';
import { LiveTaskFeed } from './LiveTaskFeed';

const baseTask: TaskResponse = {
  id: 'TM-2459',
  requester: '0xbbc100000000000000000000000000000000f042',
  requesterPubkey: '0xbbc100000000000000000000000000000000f042',
  description: 'Embed 4,201 markdown files using text-embedding-3',
  reward: '120000000',
  escrowTxHash: '0xabc',
  createdAt: new Date('2026-05-11T00:00:00Z').toISOString(),
  expiryTime: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
  status: 'open',
  tags: ['vector', 'embed'],
  worker: null,
  rating: null,
  mode: 'auction',
  stakeRequired: false,
  stakeBps: 0,
  pitchDeadline: null,
  bidDeadline: null,
  maxPrice: '150000000',
  metricDescription: null,
  metricTarget: null,
  claimedBy: null,
  claimedAt: null,
  platformFeeBps: 50,
  submissionCount: 0,
  pitchCount: 0,
  requesterAgentId: 'vecbase',
  workerAgentId: null,
  auctionType: 'dutch',
  auctionStartPrice: '150000000',
  auctionFloorPrice: '90000000',
  currentAuctionPrice: '120000000',
  auctionBidCount: 7,
  auctionPriceReachesFloorAt: null,
  auctionPriceReachesMaxAt: null,
  currentLowestBid: null,
};

describe('LiveTaskFeed', () => {
  it('renders a loading table skeleton', () => {
    render(<LiveTaskFeed tasks={[]} isLoading />);

    expect(screen.getByText('Loading open tasks')).toBeInTheDocument();
  });

  it('renders an inline error state', () => {
    render(<LiveTaskFeed tasks={[]} errorMessage="Failed to load tasks" />);

    expect(screen.getByText('Failed to load tasks')).toBeInTheDocument();
  });

  it('renders an empty state when no tasks are available', () => {
    render(<LiveTaskFeed tasks={[]} />);

    expect(screen.getByText('No open tasks matched this feed.')).toBeInTheDocument();
  });

  it('renders populated rows with task data', () => {
    render(<LiveTaskFeed tasks={[baseTask]} />);

    expect(screen.getByText('vector')).toBeInTheDocument();
    expect(screen.getByText('+120.000 USDC')).toBeInTheDocument();
    expect(screen.getByText(baseTask.description)).toBeInTheDocument();
    expect(screen.getByText('dutch')).toBeInTheDocument();
    expect(screen.getByText('vecbase')).toBeInTheDocument();
  });
});

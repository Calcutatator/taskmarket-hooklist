import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TaskResponse } from '@taskmarket/shared';
import { TaskBrowseTable } from './TaskBrowseTable';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    className,
    ...props
  }: {
    to: string;
    params?: { taskId: string };
    children: React.ReactNode;
    className?: string;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      href={params?.taskId ? to.replace('$taskId', params.taskId) : to}
      className={className}
      {...props}
    >
      {children}
    </a>
  ),
}));

const task: TaskResponse = {
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

describe('TaskBrowseTable', () => {
  it('renders loading state', () => {
    render(<TaskBrowseTable tasks={[]} isLoading />);

    expect(screen.getByText('Loading marketplace rows')).toBeInTheDocument();
  });

  it('renders error state', () => {
    render(<TaskBrowseTable tasks={[]} errorMessage="Failed to load tasks" />);

    expect(screen.getByText('Failed to load tasks')).toBeInTheDocument();
  });

  it('renders empty state', () => {
    render(<TaskBrowseTable tasks={[]} />);

    expect(screen.getByText('No tasks found for these filters.')).toBeInTheDocument();
  });

  it('renders task rows with auction data and task links', () => {
    render(<TaskBrowseTable tasks={[task]} />);

    expect(screen.getByText('TM-2459')).toBeInTheDocument();
    expect(screen.getByText('vector')).toBeInTheDocument();
    expect(screen.getByText(task.description)).toBeInTheDocument();
    expect(screen.getByText('+120.000')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('dutch')).toBeInTheDocument();
    expect(screen.getByText('vecbase')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Accept TM-2459' })).toHaveAttribute(
      'href',
      '/tasks/TM-2459'
    );
  });
});

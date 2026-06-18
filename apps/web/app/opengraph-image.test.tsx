import type { ReactElement } from 'react';
import type { AgentStats, TaskDetailResponse } from '@taskmarket/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchAgentStats, fetchTask } from '@/lib/api/server';
import { OgCard } from '@/lib/og-card';

import SiteImage, {
  alt as siteAlt,
  contentType as siteContentType,
  size as siteSize,
} from './opengraph-image';
import AgentImage, {
  alt as agentAlt,
  contentType as agentContentType,
  runtime as agentRuntime,
  size as agentSize,
} from './(public)/agents/[agentId]/opengraph-image';
import DashboardAgentImage, {
  alt as dashboardAgentAlt,
  contentType as dashboardAgentContentType,
  runtime as dashboardAgentRuntime,
  size as dashboardAgentSize,
} from './dashboard/agents/[agentId]/opengraph-image';
import DashboardTaskImage, {
  alt as dashboardTaskAlt,
  contentType as dashboardTaskContentType,
  runtime as dashboardTaskRuntime,
  size as dashboardTaskSize,
} from './dashboard/tasks/[taskId]/opengraph-image';
import TaskImage, {
  alt as taskAlt,
  contentType as taskContentType,
  runtime as taskRuntime,
  size as taskSize,
} from './(public)/tasks/[taskId]/opengraph-image';

vi.mock('next/og', () => ({
  ImageResponse: vi.fn(function ImageResponse(
    this: { element: ReactElement; headers: Headers; options: { height: number; width: number } },
    element: ReactElement,
    options: { height: number; width: number }
  ) {
    this.element = element;
    this.headers = new Headers({ 'content-type': 'image/png' });
    this.options = options;
  }),
}));

vi.mock('@/lib/api/server', () => ({
  fetchAgentStats: vi.fn(),
  fetchTask: vi.fn(),
}));

const baseTask: TaskDetailResponse = {
  auctionBidCount: null,
  auctionFloorPrice: null,
  auctionPriceReachesFloorAt: null,
  auctionPriceReachesMaxAt: null,
  auctionStartPrice: null,
  auctionType: null,
  bidDeadline: null,
  claimedAt: null,
  claimedBy: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  currentAuctionPrice: null,
  currentLowestBid: null,
  description: 'Build a reliable OG image renderer.\nInclude route coverage.',
  escrowTxHash: '0xescrow',
  expiryTime: '2026-01-08T00:00:00.000Z',
  id: 'task-123',
  maxPrice: null,
  metricDescription: null,
  metricTarget: null,
  mode: 'bounty',
  pendingActions: [],
  pitchCount: 0,
  pitchDeadline: null,
  platformFeeBps: 250,
  rating: null,
  requester: '0x0000000000000000000000000000000000000001',
  requesterPubkey: '0x0000000000000000000000000000000000000001',
  reward: '125000000',
  stakeBps: 0,
  stakeRequired: false,
  status: 'open',
  submissionCount: 0,
  tags: ['seo', 'images'],
  worker: null,
};

const baseAgent: AgentStats = {
  address: '0x0000000000000000000000000000000000000002',
  agentId: '42',
  averageRating: 4.75,
  completedTasks: 12,
  ratedTasks: 8,
  recentRatings: [],
  skills: ['typescript', 'analysis'],
  totalEarnings: '1250000000',
  totalStars: 38,
};

function expectOgCard(response: unknown) {
  const imageResponse = response as {
    element: ReactElement<{
      description: string;
      eyebrow: string;
      metrics?: Array<{ label: string; value: string }>;
      title: string;
    }>;
    options: { height: number; width: number };
  };

  expect(imageResponse.options).toEqual({ height: 630, width: 1200 });
  expect(imageResponse.element.type).toBe(OgCard);

  return imageResponse.element.props;
}

describe('opengraph image routes', () => {
  beforeEach(() => {
    vi.mocked(fetchAgentStats).mockReset();
    vi.mocked(fetchTask).mockReset();
  });

  it('exports valid metadata for every OG image endpoint', () => {
    expect(siteAlt).toBe('Taskmarket marketplace for paid autonomous agent work');
    expect(siteContentType).toBe('image/png');
    expect(siteSize).toEqual({ height: 630, width: 1200 });

    expect(taskAlt).toBe('Taskmarket task preview');
    expect(taskContentType).toBe('image/png');
    expect(taskRuntime).toBe('nodejs');
    expect(taskSize).toEqual(siteSize);

    expect(agentAlt).toBe('Taskmarket agent preview');
    expect(agentContentType).toBe('image/png');
    expect(agentRuntime).toBe('nodejs');
    expect(agentSize).toEqual(siteSize);

    expect(dashboardTaskAlt).toBe(taskAlt);
    expect(dashboardTaskContentType).toBe(taskContentType);
    expect(dashboardTaskRuntime).toBe(taskRuntime);
    expect(dashboardTaskSize).toEqual(siteSize);

    expect(dashboardAgentAlt).toBe(agentAlt);
    expect(dashboardAgentContentType).toBe(agentContentType);
    expect(dashboardAgentRuntime).toBe(agentRuntime);
    expect(dashboardAgentSize).toEqual(siteSize);
  });

  it('renders the default marketplace OG card', () => {
    const props = expectOgCard(SiteImage());

    expect(props).toMatchObject({
      description: 'Taskmarket is a marketplace for paid autonomous agent work.',
      eyebrow: 'Agent work',
      title: 'Paid work for autonomous agents',
    });
    expect(props.metrics).toEqual([
      { label: 'Escrow', value: 'USDC' },
      { label: 'Modes', value: '5' },
      { label: 'Network', value: 'Base' },
    ]);
  });

  it('renders task-specific OG details from decoded route params', async () => {
    vi.mocked(fetchTask).mockResolvedValue(baseTask);

    const props = expectOgCard(
      await TaskImage({ params: Promise.resolve({ taskId: 'task%2Fwith%20spaces' }) })
    );

    expect(fetchTask).toHaveBeenCalledWith('task/with spaces');
    expect(props).toMatchObject({
      description: 'Bounty task. Reward: 125.000 USDC. Status: open. Tags: seo, images.',
      eyebrow: 'Task',
      title: 'Build a reliable OG image renderer.',
    });
    expect(props.metrics).toEqual([
      { label: 'Reward', value: '125.000 USDC' },
      { label: 'Mode', value: 'bounty' },
      { label: 'Status', value: 'open' },
    ]);

    const dashboardProps = expectOgCard(
      await DashboardTaskImage({ params: Promise.resolve({ taskId: 'task%2Fwith%20spaces' }) })
    );

    expect(fetchTask).toHaveBeenLastCalledWith('task/with spaces');
    expect(dashboardProps).toMatchObject(props);
  });

  it('renders a generic task OG card when the task cannot be loaded', async () => {
    vi.mocked(fetchTask).mockRejectedValue(new Error('api unavailable'));

    const props = expectOgCard(await TaskImage({ params: Promise.resolve({ taskId: 'missing' }) }));

    expect(props).toMatchObject({
      description: 'Browse this Taskmarket task and related marketplace details.',
      eyebrow: 'Task',
      title: 'Taskmarket task',
    });
    expect(props.metrics).toEqual([{ label: 'Status', value: 'Unavailable' }]);
  });

  it('renders agent-specific OG details for agent id routes', async () => {
    vi.mocked(fetchAgentStats).mockResolvedValue(baseAgent);

    const props = expectOgCard(await AgentImage({ params: Promise.resolve({ agentId: '42' }) }));

    expect(fetchAgentStats).toHaveBeenCalledWith({ agentId: '42' });
    expect(props).toMatchObject({
      description:
        '12 completed tasks. Rating: 4.8. Total earned: 1,250.000 USDC. Skills: typescript, analysis.',
      eyebrow: 'Agent',
      title: 'PhotonGlowPhantom',
    });
    expect(props.metrics).toEqual([
      { label: 'Tasks', value: '12' },
      { label: 'Rating', value: '4.8' },
      { label: 'Earned', value: '1,250.000 USDC' },
    ]);

    const dashboardProps = expectOgCard(
      await DashboardAgentImage({ params: Promise.resolve({ agentId: '42' }) })
    );

    expect(fetchAgentStats).toHaveBeenLastCalledWith({ agentId: '42' });
    expect(dashboardProps).toMatchObject(props);
  });

  it('looks up raw address agent routes by address', async () => {
    vi.mocked(fetchAgentStats).mockResolvedValue({ ...baseAgent, agentId: null });

    const props = expectOgCard(
      await AgentImage({
        params: Promise.resolve({ agentId: '0x0000000000000000000000000000000000000002' }),
      })
    );

    expect(fetchAgentStats).toHaveBeenCalledWith({
      address: '0x0000000000000000000000000000000000000002',
    });
    expect(props.title).toBe('0x0000...0002');
  });

  it('renders a generic agent OG card when the agent cannot be loaded', async () => {
    vi.mocked(fetchAgentStats).mockResolvedValue(null);

    const props = expectOgCard(await AgentImage({ params: Promise.resolve({ agentId: '404' }) }));

    expect(props).toMatchObject({
      description: 'View this Taskmarket agent profile, reputation, skills, and earnings.',
      eyebrow: 'Agent',
      title: 'Taskmarket agent',
    });
    expect(props.metrics).toEqual([{ label: 'Status', value: 'Unavailable' }]);
  });
});

import type { ReactElement } from 'react';
import type { AgentStats, TaskDetailResponse } from '@taskmarket/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchAgentStats, fetchTask } from '@/lib/api/server';
import { OgBrandCard, OgCard } from '@/lib/og-card';

import SiteImage, {
  alt as siteAlt,
  contentType as siteContentType,
  size as siteSize,
} from './opengraph-image';
import TaskdropImage, {
  alt as taskdropAlt,
  contentType as taskdropContentType,
  size as taskdropSize,
} from './(public)/taskdrop/opengraph-image';
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
import StaticTasksImage from './(public)/tasks/opengraph-image';

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

vi.mock('@/lib/og-fonts', () => ({
  ogFonts: vi.fn().mockResolvedValue([]),
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
  requester: '0x0000000000000000000000000000000000000001',
  requesterPubkey: '0x0000000000000000000000000000000000000001',
  reward: '125000000',
  stakeBps: 0,
  stakeRequired: false,
  status: 'open',
  submissionWindowOpen: true,
  phase: 'active',
  submissionCount: 0,
  tags: ['seo', 'images'],
  taskVisibility: 'public',
  submissionVisibility: 'public',
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

function expectImage(response: unknown, expectedType: typeof OgCard | typeof OgBrandCard) {
  const imageResponse = response as {
    element: ReactElement<{
      badge?: string;
      description?: string;
      field?: string;
      metrics?: Array<{ label: string; value: string }>;
      title: string;
    }>;
    options: { height: number; width: number };
  };

  expect(imageResponse.options).toMatchObject({ height: 630, width: 1200 });
  expect(imageResponse.element.type).toBe(expectedType);

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

    expect(taskdropAlt).toBe('Task Drops on Taskmarket: compete in the live Task Drop');
    expect(taskdropContentType).toBe('image/png');
    expect(taskdropSize).toEqual(siteSize);

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

  it('renders the brand card for the site root', async () => {
    const props = expectImage(await SiteImage(), OgBrandCard);

    expect(props).toMatchObject({ title: 'Paid work for agents.' });
  });

  it('keeps stable metrics on static directory cards', async () => {
    const props = expectImage(await StaticTasksImage(), OgCard);

    expect(props.metrics).toEqual([
      { label: 'Modes', value: '5' },
      { label: 'Escrow', value: 'USDC' },
      { label: 'Status', value: 'Open' },
    ]);
  });

  it('renders the Task Drop card on the green field', async () => {
    const props = expectImage(await TaskdropImage(), OgCard);

    expect(props).toMatchObject({
      description: 'The fun way to start earning in the agent economy.',
      field: 'green',
      title: 'Compete in the live Task Drop.',
    });
  });

  it('renders task cards from decoded route params without reward amounts', async () => {
    vi.mocked(fetchTask).mockResolvedValue(baseTask);

    const props = expectImage(
      await TaskImage({ params: Promise.resolve({ taskId: 'task%2Fwith%20spaces' }) }),
      OgCard
    );

    expect(fetchTask).toHaveBeenCalledWith('task/with spaces');
    expect(props).toMatchObject({
      badge: 'Complete this task',
      description: 'Live on Taskmarket.',
      title: 'Build a reliable OG image renderer.',
    });
    expect(JSON.stringify(props)).not.toContain('USDC');

    const dashboardProps = expectImage(
      await DashboardTaskImage({ params: Promise.resolve({ taskId: 'task%2Fwith%20spaces' }) }),
      OgCard
    );

    expect(fetchTask).toHaveBeenLastCalledWith('task/with spaces');
    expect(dashboardProps).toMatchObject(props);
  });

  it('renders a generic task card when the task cannot be loaded', async () => {
    vi.mocked(fetchTask).mockRejectedValue(new Error('api unavailable'));

    const props = expectImage(
      await TaskImage({ params: Promise.resolve({ taskId: 'missing' }) }),
      OgCard
    );

    expect(props).toMatchObject({
      badge: 'Task',
      description: 'Live on Taskmarket.',
      title: 'Taskmarket task',
    });
  });

  it('renders agent cards for agent id routes', async () => {
    vi.mocked(fetchAgentStats).mockResolvedValue(baseAgent);

    const props = expectImage(
      await AgentImage({ params: Promise.resolve({ agentId: '42' }) }),
      OgCard
    );

    expect(fetchAgentStats).toHaveBeenCalledWith({ agentId: '42' });
    expect(props).toMatchObject({
      badge: 'Agent',
      description: 'Live on Taskmarket.',
      title: 'PhotonGlowPhantom',
    });

    const dashboardProps = expectImage(
      await DashboardAgentImage({ params: Promise.resolve({ agentId: '42' }) }),
      OgCard
    );

    expect(fetchAgentStats).toHaveBeenLastCalledWith({ agentId: '42' });
    expect(dashboardProps).toMatchObject(props);
  });

  it('looks up raw address agent routes by address', async () => {
    vi.mocked(fetchAgentStats).mockResolvedValue({ ...baseAgent, agentId: null });

    const props = expectImage(
      await AgentImage({
        params: Promise.resolve({ agentId: '0x0000000000000000000000000000000000000002' }),
      }),
      OgCard
    );

    expect(fetchAgentStats).toHaveBeenCalledWith({
      address: '0x0000000000000000000000000000000000000002',
    });
    expect(props.title).toBe('0x0000...0002');
  });

  it('renders the brand fallback when the agent cannot be loaded', async () => {
    vi.mocked(fetchAgentStats).mockResolvedValue(null);

    const props = expectImage(
      await AgentImage({ params: Promise.resolve({ agentId: '404' }) }),
      OgBrandCard
    );

    expect(props).toMatchObject({ title: 'Get your agent earning with one line.' });
  });
});

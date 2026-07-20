import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactResponse, TaskResponse } from '@taskmarket/shared';

import { TaskCover } from './task-cover';

// The cover mounts trpc.submissions.listByTask only for tasks that report activity.
// A controllable hoisted state lets each test drive loading/data/error without a real
// tRPC provider, mirroring the patterns in agents.test.tsx and live-activity.test.tsx.
const { queryState } = vi.hoisted(() => ({
  queryState: {
    value: {
      data: undefined as unknown,
      isError: false,
      isLoading: false,
    },
  },
}));

vi.mock('@/lib/api/client', () => ({
  trpc: {
    submissions: {
      listByTask: {
        useQuery: () => queryState.value,
      },
    },
  },
}));

function makeArtifact(overrides: Partial<ArtifactResponse>): ArtifactResponse {
  return {
    displayOrder: 0,
    fileName: 'artifact.png',
    id: 'artifact-1',
    keccak256Hash: '0xkeccak',
    mediaKind: 'image',
    mimeType: 'image/png',
    role: 'preview',
    sha256Hash: 'sha256',
    sizeBytes: 1024,
    storageUri: 's3://bucket/artifact.png',
    submissionId: 'sub-1',
    taskId: '0xtask',
    workerAddress: '0x3333333333333333333333333333333333333333',
    workerAgentId: null,
    ...overrides,
  };
}

function makeTask(overrides: Partial<TaskResponse>): TaskResponse {
  return {
    id: '0xtask',
    requester: '0x1111111111111111111111111111111111111111',
    requesterPubkey: '0x1111111111111111111111111111111111111111',
    description: 'Generate a campaign hero image',
    reward: '25000000',
    escrowTxHash: '0xhash',
    createdAt: new Date().toISOString(),
    expiryTime: new Date(Date.now() + 3_600_000).toISOString(),
    status: 'open',
    tags: ['design'],
    mode: 'bounty',
    stakeRequired: false,
    stakeBps: 0,
    pitchDeadline: null,
    bidDeadline: null,
    maxPrice: null,
    metricDescription: null,
    metricTarget: null,
    claimedBy: null,
    claimedAt: null,
    platformFeeBps: 250,
    submissionCount: 0,
    pitchCount: 0,
    auctionType: null,
    auctionBidCount: 0,
    submissionWindowOpen: true,
    taskVisibilityMode: 'public',
    ...overrides,
  };
}

function seedQuery(value: { data?: unknown; isError?: boolean; isLoading?: boolean }) {
  queryState.value = {
    data: value.data,
    isError: value.isError ?? false,
    isLoading: value.isLoading ?? false,
  };
}

beforeEach(() => {
  seedQuery({ data: undefined });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TaskCover', () => {
  it('renders a placeholder cover for a text-only task without detail-view metadata', () => {
    const task = makeTask({ submissionCount: 0, pitchCount: 0, auctionBidCount: 0 });

    const { container } = render(<TaskCover task={task} />);

    // The title and reward stay in the overlay.
    expect(screen.getByText(/generate a campaign hero image/i)).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();

    // The detail-view footer strings (fileName / mimeType / byte size) must never appear.
    expect(screen.queryByText('artifact.png')).not.toBeInTheDocument();
    expect(screen.queryByText(/image\/png/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bKB\b|\bMB\b|\bB\b/)).not.toBeInTheDocument();

    // No media element and no empty hole: the box is the deterministic placeholder.
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('.aspect-\\[4\\/3\\]')).not.toBeNull();
  });

  it('renders an object-cover image when a media artifact resolves, without metadata text', () => {
    const task = makeTask({ submissionCount: 2 });
    seedQuery({
      data: [
        {
          artifacts: [
            makeArtifact({
              fileName: 'hero.png',
              id: 'artifact-image',
              previewUrl: 'https://files.example.com/hero.png',
            }),
          ],
          fileUrl: 'ipfs://deliverable',
          id: 'sub-1',
          signature: '0xsig',
          submittedAt: new Date().toISOString(),
          taskId: task.id,
          workerAddress: '0x3333333333333333333333333333333333333333',
        },
      ],
    });

    const { container } = render(<TaskCover task={task} />);

    const image = screen.getByAltText('hero.png');
    expect(image).toHaveAttribute('src', 'https://files.example.com/hero.png');
    expect(image).toHaveClass('object-cover');
    expect(image).toHaveAttribute('loading', 'lazy');

    // The cover never prints the artifact mime type or byte size.
    expect(screen.queryByText(/image\/png/i)).not.toBeInTheDocument();
    expect(container.querySelector('video')).toBeNull();
  });

  it('renders a controls-free video with a play affordance for a video artifact', () => {
    const task = makeTask({ submissionCount: 1 });
    seedQuery({
      data: [
        {
          artifacts: [
            makeArtifact({
              fileName: 'walkthrough.mp4',
              id: 'artifact-video',
              mediaKind: 'video',
              mimeType: 'video/mp4',
              previewUrl: 'https://files.example.com/walkthrough.mp4',
            }),
          ],
          fileUrl: 'ipfs://deliverable',
          id: 'sub-1',
          signature: '0xsig',
          submittedAt: new Date().toISOString(),
          taskId: task.id,
          workerAddress: '0x3333333333333333333333333333333333333333',
        },
      ],
    });

    const { container } = render(<TaskCover task={task} />);

    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute('src', 'https://files.example.com/walkthrough.mp4');
    // No native controls chrome: the cover stays a uniform tile.
    expect(video).not.toHaveAttribute('controls');
    expect(video).toHaveClass('object-cover');

    // A decorative play puck signals the tile is playable.
    expect(container.querySelector('[data-task-cover-play]')).not.toBeNull();
  });

  it('shows a skeleton while the media query is loading', () => {
    const task = makeTask({ submissionCount: 1 });
    seedQuery({ data: undefined, isLoading: true });

    const { container } = render(<TaskCover task={task} />);

    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('video')).toBeNull();
  });

  it('falls back to the placeholder when the media query errors', () => {
    const task = makeTask({ submissionCount: 1 });
    seedQuery({ data: undefined, isError: true });

    const { container } = render(<TaskCover task={task} />);

    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.aspect-\\[4\\/3\\]')).not.toBeNull();
    // Overlay content (title) is still present over the placeholder.
    expect(screen.getByText(/generate a campaign hero image/i)).toBeInTheDocument();
  });

  it('shows the labeled activity count in the overlay when activity exists', () => {
    const task = makeTask({ submissionCount: 3 });
    seedQuery({ data: [] });

    render(<TaskCover task={task} />);

    expect(screen.getByText(/3 submissions/i)).toBeInTheDocument();
  });

  it('shows a split payout badge for multi-winner settlements', () => {
    render(<TaskCover task={makeTask({ awardCount: 3, status: 'completed' })} />);

    expect(screen.getByText('Split payout · 3')).toBeInTheDocument();
  });
});

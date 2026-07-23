import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskResponse } from '@taskmarket/shared';

import { LiveMarketPulseSection } from './live-market-pulse';

const { reducedMotionState } = vi.hoisted(() => ({
  reducedMotionState: { value: true },
}));

vi.mock('@/lib/api/client', () => ({
  trpc: {
    submissions: {
      // TaskThumbnail (mounted for tasks with submissions) calls this; return no
      // submissions so the thumbnail hides itself and the pulse renders as before.
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

vi.mock('@/components/market/live-tetris-background', () => ({
  LiveTetrisBackground: () => <div data-testid="live-tetris-background" />,
}));

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: unknown }) => (
    <div data-animate-presence="true">{children as never}</div>
  ),
  motion: {
    span: ({
      animate: _animate,
      initial: _initial,
      exit: _exit,
      transition: _transition,
      ...props
    }: Record<string, unknown>) => <span data-motion-span="true" {...props} />,
  },
  useReducedMotion: () => reducedMotionState.value,
}));

const task: TaskResponse = {
  auctionBidCount: 2,
  auctionType: null,
  bidDeadline: null,
  claimedAt: null,
  claimedBy: null,
  createdAt: new Date().toISOString(),
  currentLowestBid: null,
  description: 'Ship a typed parser.',
  escrowTxHash: '0xreference',
  expiryTime: new Date(Date.now() + 86_400_000).toISOString(),
  id: 'task-1',
  maxPrice: null,
  metricDescription: null,
  metricTarget: null,
  mode: 'bounty',
  platformFeeBps: 250,
  pitchCount: 1,
  pitchDeadline: null,
  requester: '0x597b0e7F366D9f985E03C8BdaF014C96a5985e4B',
  requesterPubkey: '0x597b0e7F366D9f985E03C8BdaF014C96a5985e4B',
  reward: '850000000',
  stakeBps: 0,
  stakeRequired: false,
  status: 'open',
  submissionCount: 3,
  submissionWindowOpen: true,
  phase: 'active',
  tags: ['typescript'],
  taskVisibility: 'public',
  submissionVisibility: 'public',
};

describe('LiveMarketPulseSection reduced motion', () => {
  beforeEach(() => {
    reducedMotionState.value = true;
  });

  it('renders stats and counts statically when reduced motion is requested', () => {
    const { container } = render(
      <LiveMarketPulseSection
        initialStats={{ agentCount: 4, taskCount: 12, totalRewards: '25000000' }}
        initialTasks={[task]}
      />
    );

    expect(screen.getByRole('heading', { name: /live funded work/i })).toBeVisible();

    // No framer-motion wrappers should be mounted when motion is disabled.
    expect(container.querySelector('[data-animate-presence="true"]')).toBeNull();
    expect(container.querySelector('[data-motion-span="true"]')).toBeNull();
  });
});

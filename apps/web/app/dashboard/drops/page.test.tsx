import type { TaskDropDirectoryResponse } from '@taskmarket/shared';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchTaskDropDirectoryMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/server')>();
  return {
    ...actual,
    fetchTaskDropDirectory: fetchTaskDropDirectoryMock,
  };
});

import { ApiConnectionError } from '@/lib/api/server';

import DropsPage, { metadata } from './page';

const directoryResponse: TaskDropDirectoryResponse = {
  items: [
    {
      availableTaskCount: 2,
      drop: {
        announcedAt: '2026-07-02T00:00:00.000Z',
        createdAt: '2026-07-01T00:00:00.000Z',
        description: 'Official launch work.',
        id: 'official',
        isOfficial: true,
        name: 'Official launch',
        officialWalletAddress: '0x1111111111111111111111111111111111111111',
        ownerAddress: '0x1111111111111111111111111111111111111111',
      },
      latestTaskAt: '2026-07-03T00:00:00.000Z',
      nextExpiryTime: '2099-07-09T00:00:00.000Z',
      resolvedTaskCount: 1,
      taskCount: 3,
      totalReward: '6000000',
    },
  ],
  nextCursor: 'next-page',
};

describe('DropsPage', () => {
  beforeEach(() => {
    fetchTaskDropDirectoryMock.mockReset();
  });

  it('server-renders the requested public directory page', async () => {
    fetchTaskDropDirectoryMock.mockResolvedValue(directoryResponse);

    render(
      await DropsPage({
        searchParams: Promise.resolve({
          cursor: 'current-page',
          cursorStack: 'previous-page',
        }),
      })
    );

    expect(fetchTaskDropDirectoryMock).toHaveBeenCalledWith({
      cursor: 'current-page',
      limit: 24,
    });
    expect(screen.getByRole('heading', { name: 'Official launch' })).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Task Drop pagination' })).toBeVisible();
  });

  it('turns an API outage into a recoverable page state', async () => {
    fetchTaskDropDirectoryMock.mockRejectedValue(
      new ApiConnectionError('Unavailable', {
        path: '/api/task-drops/directory',
        status: 503,
      })
    );

    render(await DropsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not load Task Drops right now. The marketplace API may be unavailable.'
    );
  });

  it('exports noindex dashboard metadata', () => {
    expect(metadata.title).toBe('Task Drop directory');
    expect(metadata.alternates).toEqual({ canonical: '/dashboard/drops' });
    expect(metadata.robots).toEqual({ follow: true, index: false });
  });
});

import type { TaskDropPageData } from '@taskmarket/shared';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TaskDropDetail } from './task-drop-detail';

vi.mock('@/components/market/task-drop-subscribe-form', () => ({
  TaskDropSubscribeForm: () => <form aria-label="Follow this drop" />,
}));

const NOW = new Date('2026-07-24T00:00:00.000Z');

const data: TaskDropPageData = {
  drop: {
    announcedAt: '2026-07-20T00:00:00.000Z',
    createdAt: '2026-07-19T00:00:00.000Z',
    description: 'Funded tasks exploring useful tools for public infrastructure.',
    id: 'civic-tools',
    isOfficial: true,
    name: 'Civic Tools',
    officialWalletAddress: '0x1111111111111111111111111111111111111111',
    ownerAddress: '0x1111111111111111111111111111111111111111',
  },
  tasks: [
    {
      createdAt: '2026-07-20T00:00:00.000Z',
      description: 'Map an accessible public service flow\nInclude source files.',
      expiryTime: '2026-07-25T00:00:00.000Z',
      id: 'available-task',
      mode: 'bounty',
      reward: '12500000',
      status: 'open',
      tags: ['research', 'accessibility'],
    },
    {
      createdAt: '2026-07-20T00:00:00.000Z',
      description: 'Prototype a resident feedback tool',
      expiryTime: '2026-07-23T00:00:00.000Z',
      id: 'expired-open-task',
      mode: 'claim',
      reward: '5000000',
      status: 'open',
      tags: [],
    },
    {
      createdAt: '2026-07-20T00:00:00.000Z',
      description: 'Document a community data standard',
      expiryTime: '2026-07-22T00:00:00.000Z',
      id: 'completed-task',
      mode: 'benchmark',
      reward: '2500000',
      status: 'completed',
      tags: ['documentation'],
    },
  ],
};

describe('TaskDropDetail', () => {
  it('summarizes availability, rewards, and the nearest deadline', () => {
    render(<TaskDropDetail data={data} now={NOW} taskHrefBase="/tasks" />);

    expect(screen.getByRole('heading', { level: 1, name: 'Civic Tools' })).toBeVisible();
    expect(screen.getByText('1 available')).toBeVisible();
    expect(screen.getByText('20 USDC')).toBeVisible();
    expect(screen.getByText('Jul 25, 2026')).toBeVisible();
  });

  it('renders the complete publisher wallet address as readable text', () => {
    render(<TaskDropDetail data={data} now={NOW} taskHrefBase="/tasks" />);

    expect(screen.getByText('0x1111111111111111111111111111111111111111')).toBeVisible();
  });

  it('keeps expired open work out of the available section', () => {
    render(<TaskDropDetail data={data} now={NOW} taskHrefBase="/tasks" />);

    const available = screen.getByRole('region', { name: 'Available tasks' });
    const inProgress = screen.getByRole('region', { name: 'Work in progress' });
    const completed = screen.getByRole('region', { name: 'Completed work' });

    expect(available).toHaveTextContent('Map an accessible public service flow');
    expect(available).not.toHaveTextContent('Prototype a resident feedback tool');
    expect(inProgress).toHaveTextContent('Prototype a resident feedback tool');
    expect(completed).toHaveTextContent('Document a community data standard');
  });

  it('groups delivered work awaiting approval as work in progress', () => {
    const pendingTask = {
      ...data.tasks[0]!,
      description: 'Prepare a task awaiting requester approval',
      expiryTime: '2026-07-20T00:00:00.000Z',
      id: 'pending-task',
      status: 'pending_approval',
    };

    render(
      <TaskDropDetail
        data={{ ...data, tasks: [...data.tasks, pendingTask] }}
        now={NOW}
        taskHrefBase="/tasks"
      />
    );

    expect(screen.getByRole('region', { name: 'Available tasks' })).not.toHaveTextContent(
      'Prepare a task awaiting requester approval'
    );
    expect(screen.getByRole('region', { name: 'Work in progress' })).toHaveTextContent(
      'Prepare a task awaiting requester approval'
    );
    expect(screen.getByText('1 available')).toBeVisible();
    expect(screen.getByText('Jul 25, 2026')).toBeVisible();
  });

  it('uses the requested task route base and places subscription before the task catalogue', () => {
    const { container } = render(
      <TaskDropDetail data={data} now={NOW} taskHrefBase="/dashboard/tasks" />
    );

    expect(
      screen.getByRole('link', { name: /map an accessible public service flow/i })
    ).toHaveAttribute('href', '/dashboard/tasks/available-task');

    const subscribe = screen.getByRole('complementary', { name: 'Drop alerts' });
    const catalogue = screen.getByRole('region', { name: 'Task catalogue' });
    expect(
      subscribe.compareDocumentPosition(catalogue) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(container.querySelector('h1')).toBeTruthy();
  });

  it('explains empty available and completed sections', () => {
    render(
      <TaskDropDetail data={{ ...data, tasks: [] }} now={NOW} taskHrefBase="/dashboard/tasks" />
    );

    expect(screen.getByText(/new tasks will appear here when they are published/i)).toBeVisible();
    expect(screen.getByText(/accepted work will appear here after judging/i)).toBeVisible();
  });
});

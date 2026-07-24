import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PendingAction, TaskDetailResponse } from '@taskmarket/shared';

import { TaskParticipationModule } from './task-participation-module';

const account = vi.hoisted(() => ({
  address: undefined as `0x${string}` | undefined,
}));

vi.mock('wagmi', () => ({
  useAccount: () => account,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/components/market/actions/submit-artifacts-form', () => ({
  SubmitArtifactsForm: () => <button type="button">Choose files</button>,
}));

const requester = '0xAaa1111111111111111111111111111111111111';
const task = {
  id: 'task-1',
  mode: 'bounty',
  requester,
  status: 'open',
} as unknown as TaskDetailResponse;
const submitAction = {
  action: 'submit',
  command: 'taskmarket task submit task-1 --file <path>',
  role: 'worker',
} as PendingAction;

describe('TaskParticipationModule', () => {
  beforeEach(() => {
    account.address = undefined;
  });

  it('gives a visitor truthful human and agent paths with developer commands collapsed', async () => {
    const user = userEvent.setup();

    render(<TaskParticipationModule action={submitAction} task={task} />);

    expect(screen.getByRole('heading', { level: 2, name: /want to take this on/i })).toBeVisible();
    expect(screen.getByText(/submit finished work from this browser/i)).toBeVisible();
    expect(screen.getByRole('article', { name: /for humans/i })).toBeVisible();
    expect(screen.getByRole('article', { name: /for agents/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /set up an agent/i })).toHaveAttribute(
      'href',
      '/dashboard/for-agents?source=task-detail&taskId=task-1'
    );
    expect(screen.getByRole('link', { name: /how this works/i })).toHaveAttribute(
      'href',
      '/dashboard/task-types'
    );

    const developerDetails = screen.getByRole('group', { name: /for developers/i });
    expect(developerDetails).not.toHaveAttribute('open');

    await user.click(screen.getByText(/for developers/i));

    expect(developerDetails).toHaveAttribute('open');
    expect(
      screen.getByText(
        'curl -fsSL http://localhost:3001/install-skill.sh | sh -s -- http://localhost:3001'
      )
    ).toBeVisible();
    expect(screen.getByText('taskmarket task list --status open')).toBeVisible();
    expect(screen.getByText('taskmarket task submit task-1 --file <path>')).toBeVisible();
    expect(screen.getByRole('link', { name: /open skill\.md/i })).toHaveAttribute(
      'href',
      'http://localhost:3001/skill.md'
    );
  });

  it('opens the existing browser upload flow for a submit action', async () => {
    const user = userEvent.setup();

    render(<TaskParticipationModule action={submitAction} task={task} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /upload files/i }));

    expect(screen.getByRole('dialog', { name: /submit work/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /choose files/i })).toBeVisible();
  });

  it('hides participation acquisition from the task requester', () => {
    account.address = requester.toLowerCase() as `0x${string}`;

    const { container } = render(<TaskParticipationModule action={submitAction} task={task} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('keeps guidance visible without exposing an assigned worker upload', () => {
    const assignedSubmitAction = {
      ...submitAction,
      eligibleAddress: '0xBbb2222222222222222222222222222222222222',
    } as PendingAction;
    const { rerender } = render(
      <TaskParticipationModule action={assignedSubmitAction} task={task} />
    );

    expect(screen.getByRole('heading', { name: /want to take this on/i })).toBeVisible();
    expect(screen.getByText(/if you are eligible/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: /upload files/i })).not.toBeInTheDocument();

    account.address = '0xCcc3333333333333333333333333333333333333';
    rerender(<TaskParticipationModule action={assignedSubmitAction} task={task} />);

    expect(screen.getByRole('heading', { name: /want to take this on/i })).toBeVisible();
    expect(screen.queryByRole('button', { name: /upload files/i })).not.toBeInTheDocument();
  });

  it('keeps a pre-submission task truthful without offering an immediate upload', () => {
    const claimAction = {
      action: 'claim',
      command: 'taskmarket task claim task-1',
      role: 'worker',
    } as PendingAction;

    render(<TaskParticipationModule action={claimAction} task={task} />);

    expect(screen.getByText(/use the task action on this page/i)).toBeVisible();
    expect(screen.queryByRole('article', { name: /for humans/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /upload files/i })).not.toBeInTheDocument();
    expect(screen.getByText('taskmarket task claim task-1')).toBeInTheDocument();
  });
});

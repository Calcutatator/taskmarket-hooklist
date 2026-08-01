import type { SubmissionResponse, TaskDetailResponse } from '@taskmarket/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { WorkerSubmissionGroup } from '@/lib/market/submission-review';

import { WorkerSubmissionHistory } from './worker-submission-history';

const WORKER = '0x2222222222222222222222222222222222222222';

const task = {
  id: 'task-1',
  pendingActions: [],
  requester: '0x1111111111111111111111111111111111111111',
  status: 'open',
} as unknown as TaskDetailResponse;

function submission(index: number, rejected = false): SubmissionResponse {
  return {
    artifacts: [],
    fileUrl: `ipfs://submission-${index}`,
    id: `submission-${String(index).padStart(2, '0')}`,
    rejectedAt: rejected ? '2026-07-31T12:30:00.000Z' : null,
    signature: '0xsignature',
    submittedAt: new Date(Date.UTC(2026, 6, index, 12)).toISOString(),
    taskId: task.id,
    workerAddress: WORKER,
  };
}

function group(count: number, rejected = false): WorkerSubmissionGroup {
  const submissions = Array.from({ length: count }, (_, index) =>
    submission(count - index, rejected && index === 0)
  );

  return {
    firstSubmittedAt: submissions.at(-1)!.submittedAt,
    latestSubmittedAt: submissions[0]!.submittedAt,
    rejected,
    representativeSubmission: submissions[0]!,
    submissions,
    workerAddress: WORKER,
    workerKey: WORKER,
    workerStats: null,
  };
}

describe('WorkerSubmissionHistory', () => {
  it('lets the requester review a large worker history without losing the outer context', () => {
    const onBack = vi.fn();

    render(
      <WorkerSubmissionHistory
        actionArea={<button type="button">Worker decision</button>}
        group={group(12)}
        initialView="gallery"
        onBack={onBack}
        profileBasePath="/dashboard/agents"
        task={task}
        visibilityScopeKey="task-1:public"
      />
    );

    expect(screen.getByRole('heading', { name: 'Submitter history' })).toHaveFocus();
    expect(screen.getByText('12 submissions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Worker decision' })).toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: /Submission \d+ of 12/ })).toHaveLength(10);
    expect(screen.getByText('Latest active')).toBeInTheDocument();
    expect(screen.getByText('Showing 1-10 of 12 submissions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gallery view' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    fireEvent.click(screen.getByRole('button', { name: 'List view' }));
    expect(screen.getByRole('button', { name: 'List view' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getAllByRole('region', { name: /Submission \d+ of 12/ })).toHaveLength(2);
    expect(screen.getByText('Showing 11-12 of 12 submissions')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to all submitters' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('renders rejected history as read-only audit context', () => {
    render(
      <WorkerSubmissionHistory
        actionArea={<button type="button">Must not render</button>}
        group={group(2, true)}
        initialView="list"
        onBack={vi.fn()}
        profileBasePath="/dashboard/agents"
        task={task}
        visibilityScopeKey="task-1:public"
      />
    );

    expect(screen.getAllByText('Rejected').length).toBeGreaterThan(0);
    expect(screen.getByText('Rejected with submitter')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Must not render' })).not.toBeInTheDocument();
  });
});

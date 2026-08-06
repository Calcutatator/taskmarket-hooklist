import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PendingAction, SubmissionResponse, TaskDetailResponse } from '@taskmarket/shared';

import type { WorkerSubmissionGroup } from '@/lib/market/submission-review';

import { WorkerSubmissionActions } from './worker-submission-actions';

const { account, payX402Post, refresh } = vi.hoisted(() => ({
  account: {
    address: '0x1111111111111111111111111111111111111111' as `0x${string}` | undefined,
    isConnected: true,
  },
  payX402Post: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock('wagmi', () => ({
  useAccount: () => account,
  useSignTypedData: () => ({ signTypedDataAsync: vi.fn() }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/lib/x402-client', () => ({
  payX402Post: (...args: unknown[]) => payX402Post(...args),
}));

vi.mock('@/lib/use-action-queue', () => ({
  useInvalidateActionQueue: () => vi.fn().mockResolvedValue(undefined),
}));

const requester = '0x1111111111111111111111111111111111111111';
const selectedWorker = '0x2222222222222222222222222222222222222222';
const suggestedWorker = '0x3333333333333333333333333333333333333333';

const task = {
  id: 'task-1',
  requester,
  reward: '5000000',
} as unknown as TaskDetailResponse;

const submissions = [
  {
    id: 'submission-new',
    submittedAt: '2026-07-31T02:00:00.000Z',
    workerAddress: selectedWorker,
  },
  {
    id: 'submission-old',
    submittedAt: '2026-07-31T01:00:00.000Z',
    workerAddress: selectedWorker,
  },
] as SubmissionResponse[];

const group = {
  firstSubmittedAt: submissions[1].submittedAt,
  latestSubmittedAt: submissions[0].submittedAt,
  rejected: false,
  representativeSubmission: submissions[0],
  submissions,
  workerAddress: selectedWorker,
  workerKey: selectedWorker.toLowerCase(),
  workerStats: undefined,
} as WorkerSubmissionGroup;

const acceptAction = {
  action: 'accept',
  command: `taskmarket task accept task-1 --worker ${suggestedWorker}`,
  role: 'requester',
} as PendingAction;

const rejectAction = {
  action: 'reject_submission',
  command: `taskmarket task reject-submission task-1 --worker ${suggestedWorker}`,
  role: 'requester',
} as PendingAction;

describe('WorkerSubmissionActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    account.address = requester;
    account.isConnected = true;
    payX402Post.mockResolvedValue({ ok: true, txHash: '0xabc' });
  });

  it('targets payout to the selected group and explains latest-submission semantics', async () => {
    const user = userEvent.setup();

    render(
      <WorkerSubmissionActions
        acceptAction={acceptAction}
        group={group}
        onRejectSuccess={vi.fn()}
        rejectAction={rejectAction}
        task={task}
      />
    );

    expect(
      screen.getByText('Releases payout to this worker using their latest active submission.')
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Release payout' }));
    const releaseButtons = await screen.findAllByRole('button', { name: 'Release payout' });
    await user.click(releaseButtons[releaseButtons.length - 1]);

    await waitFor(() => expect(payX402Post).toHaveBeenCalledTimes(1));
    expect(payX402Post.mock.calls[0][1]).toEqual({
      taskId: 'task-1',
      worker: selectedWorker,
    });
  });

  it('renders one worker-wide rejection action with the complete active count', () => {
    render(
      <WorkerSubmissionActions
        acceptAction={acceptAction}
        group={group}
        onRejectSuccess={vi.fn()}
        rejectAction={rejectAction}
        task={task}
      />
    );

    expect(
      screen.getAllByRole('button', { name: 'Reject submitter and all 2 submissions' })
    ).toHaveLength(1);
  });

  it('offers no decisions for a rejected group', () => {
    const { container } = render(
      <WorkerSubmissionActions
        acceptAction={acceptAction}
        group={{ ...group, rejected: true }}
        onRejectSuccess={vi.fn()}
        rejectAction={rejectAction}
        task={task}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const signMessageAsync = vi.fn();

vi.mock('wagmi', () => ({
  useAccount: vi.fn(),
  useSignMessage: () => ({ signMessageAsync }),
  useSignTypedData: () => ({ signTypedDataAsync: vi.fn() }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
}));

vi.mock('@/lib/api', () => ({
  API_URL: 'https://api.example.com',
}));

import { useAccount } from 'wagmi';
import type { SubmissionResponse, TaskResponse } from '@taskmarket/shared';
import { ContestPanel } from './ContestPanel';

type AccountReturn = ReturnType<typeof useAccount>;

const mockConnectedAccount = (address: `0x${string}`) => {
  vi.mocked(useAccount).mockReturnValue({
    address,
    isConnected: true,
  } as unknown as AccountReturn);
};

const task: TaskResponse = {
  id: '0xtask',
  requester: '0xRequester00000000000000000000000000000001',
  requesterPubkey: '0xRequester00000000000000000000000000000001',
  description: 'Test task',
  reward: '1000000',
  escrowTxHash: '0xhash',
  createdAt: new Date().toISOString(),
  expiryTime: new Date().toISOString(),
  status: 'pending_approval',
  tags: [],
  worker: null,
  rating: null,
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
  platformFeeBps: 500,
  submissionCount: 1,
  pitchCount: 0,
};

const submission: SubmissionResponse = {
  id: 'submission-1',
  taskId: '0xtask',
  workerAddress: '0xWorker0000000000000000000000000000000001',
  workerAgentId: null,
  fileUrl: 's3://bucket/logo.png',
  signature: '0xsig',
  submittedAt: new Date().toISOString(),
  artifacts: [
    {
      id: 'artifact-1',
      taskId: '0xtask',
      submissionId: 'submission-1',
      role: 'preview',
      fileName: 'logo.png',
      mimeType: 'image/png',
      mediaKind: 'image',
      storageUri: 's3://bucket/logo.png',
      sizeBytes: 100,
      sha256Hash: 'a'.repeat(64),
      keccak256Hash: `0x${'b'.repeat(64)}`,
      displayOrder: 0,
    },
  ],
};

describe('ContestPanel artifact previews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectedAccount(task.requester as `0x${string}`);
    signMessageAsync.mockResolvedValue('0xsignature');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ previewUrl: 'https://example.com/logo.png' }),
      })
    );
  });

  it('requests artifact preview URLs only for the requester', async () => {
    render(<ContestPanel task={task} submissions={[submission]} />);

    fireEvent.click(screen.getByRole('button', { name: /load previews/i }));

    await waitFor(() => {
      expect(signMessageAsync).toHaveBeenCalledWith({
        message: 'taskmarket:artifact-preview:0xtask:artifact-1',
      });
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/api/tasks/0xtask/artifacts/artifact-1/preview',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          taskId: '0xtask',
          artifactId: 'artifact-1',
          viewerAddress: task.requester,
          signature: '0xsignature',
        }),
      })
    );
  });

  it('does not request preview URLs for non-requesters', () => {
    mockConnectedAccount('0xOther000000000000000000000000000000000001');

    render(<ContestPanel task={task} submissions={[submission]} />);

    expect(screen.queryByRole('button', { name: /load previews/i })).not.toBeInTheDocument();
    expect(signMessageAsync).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

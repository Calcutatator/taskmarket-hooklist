import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/server', () => ({
  fetchTask: vi.fn(),
  fetchTaskDrop: vi.fn(),
  fetchTaskSubmissions: vi.fn(),
}));

import { fetchTask, fetchTaskDrop, fetchTaskSubmissions } from '@/lib/api/server';

import { loadDropPage } from './drop-data';

const DROP_ID = 'drop-1';
const TASK_ID = 'task-1';

function dropData() {
  return {
    drop: {
      announcedAt: null,
      createdAt: '2026-07-26T00:00:00.000Z',
      description: 'A drop',
      id: DROP_ID,
      isOfficial: false,
      name: 'Drop one',
      officialWalletAddress: '0x1111111111111111111111111111111111111111',
      ownerAddress: '0x1111111111111111111111111111111111111111',
    },
    tasks: [
      {
        createdAt: '2026-07-26T00:00:00.000Z',
        description: '**A task title**\nMore detail',
        expiryTime: '2026-07-28T00:00:00.000Z',
        id: TASK_ID,
        mode: 'bounty',
        reward: '1000000',
        status: 'pending_approval',
        tags: [],
      },
    ],
  };
}

function taskDetail() {
  return {
    awards: [
      {
        rank: 1,
        rating: 98,
        workerAddress: '0x2222222222222222222222222222222222222222',
        workerAgentId: 'winner',
      },
      {
        rank: 2,
        rating: 98,
        workerAddress: '0x2222222222222222222222222222222222222222',
        workerAgentId: 'winner',
      },
      {
        rank: 3,
        rating: 91,
        workerAddress: '0x3333333333333333333333333333333333333333',
        workerAgentId: 'runner-up',
      },
    ],
    mode: 'bounty',
    phase: 'active',
    submissionCount: 1,
    submissionVisibility: 'public',
    submissionWindowOpen: false,
    taskVisibility: 'public',
  };
}

describe('loadDropPage', () => {
  beforeEach(() => {
    vi.mocked(fetchTaskDrop).mockResolvedValue(dropData() as never);
    vi.mocked(fetchTask).mockResolvedValue(taskDetail() as never);
    vi.mocked(fetchTaskSubmissions).mockResolvedValue([
      {
        artifacts: [],
        rejectedAt: null,
        submittedAt: '2026-07-26T00:00:00.000Z',
        workerAddress: '0x2222222222222222222222222222222222222222',
      },
      {
        artifacts: [],
        rejectedAt: '2026-07-26T01:00:00.000Z',
        submittedAt: '2026-07-26T00:30:00.000Z',
        workerAddress: '0x4444444444444444444444444444444444444444',
      },
    ] as never);
  });

  it('keeps lifecycle activity separate from entryability and excludes rejected rows', async () => {
    const result = await loadDropPage(DROP_ID);

    expect(result?.tasks[0]).toMatchObject({
      acceptsEntries: false,
      entries: 1,
      phase: 'active',
      title: 'A task title',
    });
    expect(result?.tasks[0].winners.map((winner) => winner.workerAgentId)).toEqual([
      'winner',
      'runner-up',
    ]);
    expect(result?.tasks[0].cover).toBeNull();
  });

  it('fails instead of manufacturing empty task data when detail loading fails', async () => {
    vi.mocked(fetchTask).mockRejectedValueOnce(new Error('backend unavailable'));

    await expect(loadDropPage(DROP_ID)).rejects.toThrow('backend unavailable');
  });

  it('never labels another entrant media as a winner preview', async () => {
    vi.mocked(fetchTaskSubmissions).mockResolvedValueOnce([
      {
        artifacts: [],
        rejectedAt: null,
        submittedAt: '2026-07-26T00:00:00.000Z',
        workerAddress: '0x2222222222222222222222222222222222222222',
      },
      {
        artifacts: [
          {
            fileName: 'losing-entry.jpg',
            mediaKind: 'image',
            previewUrl: 'https://example.com/losing-entry.jpg',
          },
        ],
        rejectedAt: null,
        submittedAt: '2026-07-26T00:30:00.000Z',
        workerAddress: '0x4444444444444444444444444444444444444444',
      },
    ] as never);

    const result = await loadDropPage(DROP_ID);

    expect(result?.tasks[0].cover).toBeNull();
  });

  it('fails instead of presenting a submission-read failure as an empty field', async () => {
    vi.mocked(fetchTaskSubmissions).mockRejectedValueOnce(new Error('submissions unavailable'));

    await expect(loadDropPage(DROP_ID)).rejects.toThrow('submissions unavailable');
  });
});

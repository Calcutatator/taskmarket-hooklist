import type {
  ArtifactResponse,
  SubmissionResponse,
  TaskDetailResponse,
  TaskDropDirectoryItem,
  TaskResponse,
} from '@taskmarket/shared';

const NOW = '2026-08-02T01:00:00.000Z';

export const addresses = {
  evaluator: '0x2222222222222222222222222222222222222222',
  requester: '0x1111111111111111111111111111111111111111',
  worker: '0x3333333333333333333333333333333333333333',
  workerB: '0x4444444444444444444444444444444444444444',
} as const;

export const baseTask: TaskResponse = {
  auctionBidCount: 0,
  auctionType: null,
  bidDeadline: null,
  claimedAt: null,
  claimedBy: null,
  createdAt: NOW,
  description: 'Evaluate the protocol documentation and summarize the highest-impact improvements',
  escrowTxHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  expiryTime: '2026-08-09T01:00:00.000Z',
  id: '0xabc123',
  maxPrice: null,
  metricDescription: null,
  metricTarget: null,
  mode: 'bounty',
  phase: 'active',
  pitchCount: 0,
  pitchDeadline: null,
  platformFeeBps: 250,
  requester: addresses.requester,
  requesterPubkey: addresses.requester,
  reward: '250000000',
  stakeBps: 0,
  stakeRequired: false,
  status: 'open',
  submissionCount: 0,
  submissionVisibility: 'public',
  submissionWindowOpen: true,
  tags: ['research', 'protocol', 'documentation'],
  taskVisibility: 'public',
};

export function taskFixture(overrides: Partial<TaskResponse> = {}): TaskResponse {
  return { ...baseTask, ...overrides };
}

export function taskDetailFixture(overrides: Partial<TaskDetailResponse> = {}): TaskDetailResponse {
  return {
    ...baseTask,
    pendingActions: [],
    ...overrides,
  };
}

export function artifactFixture(overrides: Partial<ArtifactResponse> = {}): ArtifactResponse {
  return {
    displayOrder: 0,
    fileName: 'protocol-review.png',
    id: 'artifact-1',
    keccak256Hash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    mediaKind: 'image',
    mimeType: 'image/png',
    previewUrl: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200',
    role: 'preview',
    sha256Hash: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    sizeBytes: 1_024_000,
    storageUri: 'ipfs://bafybeifake/protocol-review.png',
    submissionId: 'submission-1',
    taskId: baseTask.id,
    workerAddress: addresses.worker,
    workerAgentId: '42',
    ...overrides,
  };
}

export function submissionFixture(overrides: Partial<SubmissionResponse> = {}): SubmissionResponse {
  return {
    artifacts: [artifactFixture()],
    fileUrl: 'ipfs://bafybeifake/deliverable',
    id: 'submission-1',
    signature: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    submittedAt: '2026-08-02T02:00:00.000Z',
    taskId: baseTask.id,
    workerAddress: addresses.worker,
    workerAgentId: '42',
    ...overrides,
  };
}

export const taskDropItems: TaskDropDirectoryItem[] = [
  {
    availableTaskCount: 2,
    drop: {
      announcedAt: '2026-07-28T00:00:00.000Z',
      createdAt: '2026-07-27T00:00:00.000Z',
      description: 'A focused collection of research, design, and launch work.',
      id: 'launch-week',
      isOfficial: true,
      name: 'Launch week',
      officialWalletAddress: addresses.requester,
      ownerAddress: addresses.requester,
    },
    latestTaskAt: '2026-08-02T00:00:00.000Z',
    nextExpiryTime: '2026-08-09T00:00:00.000Z',
    resolvedTaskCount: 1,
    taskCount: 3,
    totalReward: '600000000',
  },
  {
    availableTaskCount: 0,
    drop: {
      announcedAt: '2026-07-16T00:00:00.000Z',
      createdAt: '2026-07-15T00:00:00.000Z',
      description:
        'A long community-owned drop description that verifies cards remain balanced with dense user-provided content across multiple lines.',
      id: 'community-research',
      isOfficial: false,
      name: 'Community research sprint with a deliberately long title',
      officialWalletAddress: addresses.workerB,
      ownerAddress: addresses.workerB,
    },
    latestTaskAt: '2026-07-30T00:00:00.000Z',
    nextExpiryTime: null,
    resolvedTaskCount: 4,
    taskCount: 4,
    totalReward: '1250000000',
  },
];

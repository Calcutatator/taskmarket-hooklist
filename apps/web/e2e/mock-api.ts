import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import type {
  AgentStats,
  ArtifactMediaKindValue,
  ArtifactResponse,
  ArtifactRoleValue,
  BidResponse,
  ClaimResponse,
  LeaderboardEntry,
  PendingAction,
  PitchResponse,
  ProofResponse,
  SubmissionResponse,
  TaskDetailResponse,
  TaskModeType,
  TaskResponse,
} from '@taskmarket/shared';

const requester = '0x8f12A4c661F9b365D408bF4a3Dd079fd9a5E2011';
const workerOne = '0x3333333333333333333333333333333333333333';
const workerTwo = '0x4444444444444444444444444444444444444444';
const workerThree = '0x5555555555555555555555555555555555555555';
const now = new Date('2026-05-13T00:00:00.000Z').toISOString();

function hoursFromNow(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function task(
  overrides: Partial<TaskDetailResponse> & {
    description: string;
    id: string;
    mode: TaskModeType;
  }
): TaskDetailResponse {
  const { description, id, mode, ...rest } = overrides;

  return {
    auctionBidCount: null,
    auctionFloorPrice: null,
    auctionPriceReachesFloorAt: null,
    auctionPriceReachesMaxAt: null,
    auctionStartPrice: null,
    auctionType: null,
    bidDeadline: null,
    claimedAt: null,
    claimedBy: null,
    createdAt: now,
    currentAuctionPrice: null,
    currentLowestBid: null,
    description,
    escrowTxHash: `0x${id.replace(/[^a-z0-9]/gi, '').padEnd(12, '0')}`,
    expiryTime: hoursFromNow(72),
    id,
    maxPrice: null,
    metricDescription: null,
    metricTarget: null,
    mode,
    pendingActions: [],
    pitchCount: 0,
    pitchDeadline: null,
    platformFeeBps: 250,
    rating: null,
    requester,
    requesterActorType: 'human',
    requesterAgentId: null,
    requesterPubkey: requester,
    reward: '240000000',
    stakeBps: 0,
    stakeRequired: false,
    status: 'open',
    submissionCount: 0,
    tags: ['mock'],
    worker: null,
    workerActorType: undefined,
    workerAgentId: null,
    ...rest,
  };
}

function action(taskId: string, role: PendingAction['role'], actionName: PendingAction['action']) {
  const commandName = actionName.replaceAll('_', '-');
  return {
    action: actionName,
    command: `taskmarket task ${commandName} ${taskId}`,
    role,
  } satisfies PendingAction;
}

function artifact({
  fileName,
  id,
  mediaKind,
  mimeType,
  role = 'attachment',
  submissionId,
  taskId,
  textPreview,
  workerAddress = workerOne,
  workerAgentId = '1003',
}: {
  fileName: string;
  id: string;
  mediaKind: ArtifactMediaKindValue;
  mimeType: string;
  role?: ArtifactRoleValue;
  submissionId: string;
  taskId: string;
  textPreview?: string;
  workerAddress?: string;
  workerAgentId?: string | null;
}): ArtifactResponse {
  return {
    displayOrder: 0,
    fileName,
    id,
    keccak256Hash: `0x${id
      .replace(/[^a-f0-9]/gi, '')
      .padEnd(64, 'f')
      .slice(0, 64)}`,
    mediaKind,
    mimeType,
    role,
    sha256Hash: id
      .replace(/[^a-f0-9]/gi, '')
      .padEnd(64, 'a')
      .slice(0, 64),
    sizeBytes: 1024 * 900,
    storageUri: `s3://mock/${taskId}/${fileName}`,
    submissionId,
    taskId,
    textPreview,
    workerAddress,
    workerAgentId,
  };
}

function submission({
  artifacts = [],
  id,
  taskId,
  workerAddress = workerOne,
  workerAgentId = '1003',
}: {
  artifacts?: ArtifactResponse[];
  id: string;
  taskId: string;
  workerAddress?: string;
  workerAgentId?: string | null;
}): SubmissionResponse {
  return {
    artifacts,
    deliverableHash: `0x${id
      .replace(/[^a-f0-9]/gi, '')
      .padEnd(64, 'd')
      .slice(0, 64)}`,
    fileUrl: `ipfs://${id}`,
    id,
    signature: '0xsig',
    submittedAt: hoursFromNow(-6),
    submitTxHash: `0x${id
      .replace(/[^a-f0-9]/gi, '')
      .padEnd(64, 'b')
      .slice(0, 64)}`,
    taskId,
    workerAddress,
    workerAgentId,
    workerStats: {
      averageRating: 4.7,
      completedTasks: 18,
      ratedTasks: 12,
      totalStars: 56,
    },
  };
}

const tasks: TaskDetailResponse[] = [
  task({
    description: 'Bounty - open submission pool for settlement receipt review.',
    id: 'mock-bounty-open',
    mode: 'bounty',
    pendingActions: [
      {
        action: 'submit',
        command: 'taskmarket task submit mock-bounty-open --file <path>',
        role: 'worker',
      },
      action('mock-bounty-open', 'requester', 'cancel'),
      action('mock-bounty-open', 'requester', 'update'),
    ],
    reward: '240000000',
    submissionCount: 0,
    tags: ['bounty', 'open'],
  }),
  task({
    description:
      'Bounty - pending requester review with multiple submissions and mixed artifact types.',
    id: 'e2e-pending-review',
    mode: 'bounty',
    pendingActions: [
      {
        action: 'accept',
        command:
          'taskmarket task accept e2e-pending-review --worker 0x3333333333333333333333333333333333333333 --receipt 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        role: 'requester',
      },
    ],
    reward: '240000000',
    status: 'pending_approval',
    submissionCount: 2,
    tags: ['bounty', 'review'],
  }),
  task({
    description: 'Bounty - accepted deliverable waiting for requester rating.',
    id: 'mock-bounty-accepted-unrated',
    mode: 'bounty',
    pendingActions: [action('mock-bounty-accepted-unrated', 'requester', 'rate')],
    rating: null,
    status: 'completed',
    submissionCount: 1,
    tags: ['bounty', 'rating'],
    worker: workerOne,
    workerAgentId: '1003',
  }),
  task({
    description: 'Bounty - completed and rated reference task.',
    id: 'mock-bounty-completed-rated',
    mode: 'bounty',
    rating: 94,
    status: 'completed',
    submissionCount: 1,
    tags: ['bounty', 'complete'],
    worker: workerOne,
    workerAgentId: '1003',
  }),
  task({
    description: 'Claim - first worker reserves before delivering the artifact.',
    id: 'mock-claim-open',
    mode: 'claim',
    pendingActions: [
      action('mock-claim-open', 'worker', 'claim'),
      action('mock-claim-open', 'requester', 'cancel'),
      action('mock-claim-open', 'requester', 'update'),
    ],
    reward: '180000000',
    stakeBps: 1000,
    stakeRequired: true,
    tags: ['claim', 'stake'],
  }),
  task({
    claimedAt: hoursFromNow(-12),
    claimedBy: workerOne,
    description: 'Claim - worker has reserved the task and can submit work.',
    id: 'mock-claim-claimed',
    mode: 'claim',
    pendingActions: [
      {
        action: 'submit',
        command: 'taskmarket task submit mock-claim-claimed --file <path>',
        role: 'worker',
      },
      action('mock-claim-claimed', 'requester', 'forfeit'),
    ],
    reward: '320000000',
    stakeBps: 1000,
    stakeRequired: true,
    status: 'claimed',
    tags: ['claim', 'assigned'],
    worker: workerOne,
    workerAgentId: '1003',
  }),
  task({
    description: 'Pitch - requester compares proposals before selecting a worker.',
    id: 'mock-pitch-open',
    mode: 'pitch',
    pendingActions: [
      {
        action: 'pitch',
        command: 'taskmarket task pitch mock-pitch-open --text "..."',
        role: 'worker',
      },
      {
        action: 'select_worker',
        command:
          'taskmarket task select-worker mock-pitch-open --pitch <pitchId> --worker <address>',
        role: 'requester',
      },
    ],
    pitchCount: 2,
    pitchDeadline: hoursFromNow(18),
    reward: '420000000',
    tags: ['pitch', 'proposals'],
  }),
  task({
    description: 'Pitch - requester selected a worker and delivery is underway.',
    id: 'mock-pitch-selected',
    mode: 'pitch',
    pendingActions: [
      {
        action: 'submit',
        command: 'taskmarket task submit mock-pitch-selected --file <path>',
        role: 'worker',
      },
    ],
    pitchCount: 2,
    pitchDeadline: hoursFromNow(-2),
    reward: '420000000',
    status: 'worker_selected',
    tags: ['pitch', 'selected'],
    worker: workerTwo,
    workerAgentId: '1004',
  }),
  task({
    description: 'Benchmark - workers submit measurable proof against a target metric.',
    id: 'mock-benchmark-open',
    metricDescription: 'Latency reduction on the fixture workload',
    metricTarget: 'p95 latency below 120ms with reproducible logs',
    mode: 'benchmark',
    pendingActions: [
      {
        action: 'submit_proof',
        command: 'taskmarket task submit-proof mock-benchmark-open --type eval --data <json>',
        role: 'worker',
      },
      action('mock-benchmark-open', 'requester', 'cancel'),
      action('mock-benchmark-open', 'requester', 'update'),
    ],
    reward: '510000000',
    tags: ['benchmark', 'proof'],
  }),
  task({
    auctionBidCount: 3,
    auctionType: 'english',
    bidDeadline: hoursFromNow(20),
    currentLowestBid: '600000000',
    description: 'Auction - English open undercutting with visible bids.',
    id: 'mock-auction-english-open',
    maxPrice: '850000000',
    mode: 'auction',
    pendingActions: [
      {
        action: 'bid',
        command: 'taskmarket task bid mock-auction-english-open --price <n>',
        role: 'worker',
      },
      action('mock-auction-english-open', 'requester', 'cancel'),
      action('mock-auction-english-open', 'requester', 'update'),
    ],
    reward: '850000000',
    tags: ['auction', 'english'],
  }),
  task({
    auctionBidCount: 2,
    auctionType: 'english',
    bidDeadline: hoursFromNow(-3),
    currentLowestBid: '520000000',
    description: 'Auction - English bidding ended, requester selects the winner.',
    id: 'mock-auction-english-select-winner',
    maxPrice: '850000000',
    mode: 'auction',
    pendingActions: [
      {
        action: 'select_winner',
        command:
          'taskmarket task select-winner mock-auction-english-select-winner --worker <address>',
        role: 'requester',
      },
    ],
    reward: '850000000',
    tags: ['auction', 'winner'],
  }),
  task({
    auctionBidCount: 2,
    auctionType: 'reverse_english',
    bidDeadline: hoursFromNow(24),
    description: 'Auction - Reverse English sealed bids before the close.',
    id: 'mock-auction-reverse-english-open',
    maxPrice: '900000000',
    mode: 'auction',
    pendingActions: [
      {
        action: 'bid',
        command: 'taskmarket task bid mock-auction-reverse-english-open --price <n>',
        role: 'worker',
      },
    ],
    reward: '900000000',
    tags: ['auction', 'reverse-english'],
  }),
  task({
    auctionFloorPrice: '450000000',
    auctionPriceReachesFloorAt: hoursFromNow(12),
    auctionStartPrice: '950000000',
    auctionType: 'dutch',
    currentAuctionPrice: '710000000',
    description: 'Auction - Dutch descending clock, first worker to accept wins.',
    id: 'mock-auction-dutch-open',
    maxPrice: '950000000',
    mode: 'auction',
    pendingActions: [
      {
        action: 'auction_accept',
        command: 'taskmarket task auction-accept mock-auction-dutch-open',
        role: 'worker',
      },
    ],
    reward: '950000000',
    tags: ['auction', 'dutch'],
  }),
  task({
    auctionFloorPrice: '350000000',
    auctionPriceReachesMaxAt: hoursFromNow(12),
    auctionStartPrice: '350000000',
    auctionType: 'reverse_dutch',
    currentAuctionPrice: '480000000',
    description: 'Auction - Reverse Dutch ascending clock, first worker to accept wins.',
    id: 'mock-auction-reverse-dutch-open',
    maxPrice: '950000000',
    mode: 'auction',
    pendingActions: [
      {
        action: 'auction_accept',
        command: 'taskmarket task auction-accept mock-auction-reverse-dutch-open',
        role: 'worker',
      },
    ],
    reward: '950000000',
    tags: ['auction', 'reverse-dutch'],
  }),
  task({
    description: 'Cancelled task reference state.',
    id: 'mock-cancelled',
    mode: 'bounty',
    reward: '120000000',
    status: 'cancelled',
    tags: ['cancelled'],
  }),
  task({
    description: 'Expired task reference state.',
    expiryTime: hoursFromNow(-24),
    id: 'mock-expired',
    mode: 'claim',
    reward: '120000000',
    status: 'expired',
    tags: ['expired'],
  }),
];

const submissionsByTaskId = new Map<string, SubmissionResponse[]>([
  [
    'e2e-pending-review',
    [
      submission({
        artifacts: [
          artifact({
            fileName: 'candidate-a.png',
            id: 'e2e-artifact-image',
            mediaKind: 'image',
            mimeType: 'image/png',
            role: 'preview',
            submissionId: 'e2e-submission-1',
            taskId: 'e2e-pending-review',
          }),
          artifact({
            fileName: 'candidate-a-demo.mp4',
            id: 'e2e-artifact-video',
            mediaKind: 'video',
            mimeType: 'video/mp4',
            role: 'preview',
            submissionId: 'e2e-submission-1',
            taskId: 'e2e-pending-review',
          }),
          artifact({
            fileName:
              'final-analysis-pack-with-very-long-name-and-settlement-receipt-reference-2026-05-13.pdf',
            id: 'e2e-artifact-pdf',
            mediaKind: 'pdf',
            mimeType: 'application/pdf',
            role: 'final',
            submissionId: 'e2e-submission-1',
            taskId: 'e2e-pending-review',
          }),
          artifact({
            fileName: 'review-notes.txt',
            id: 'e2e-artifact-text',
            mediaKind: 'text',
            mimeType: 'text/plain',
            role: 'source',
            submissionId: 'e2e-submission-1',
            taskId: 'e2e-pending-review',
            textPreview: 'Reviewed duplicate settlement receipts and reconciled agent addresses.',
          }),
          artifact({
            fileName: 'evidence-bundle.zip',
            id: 'e2e-artifact-archive',
            mediaKind: 'archive',
            mimeType: 'application/zip',
            role: 'attachment',
            submissionId: 'e2e-submission-1',
            taskId: 'e2e-pending-review',
          }),
        ],
        id: 'e2e-submission-1',
        taskId: 'e2e-pending-review',
      }),
      submission({
        artifacts: [],
        id: 'e2e-submission-2',
        taskId: 'e2e-pending-review',
        workerAddress: workerTwo,
        workerAgentId: null,
      }),
    ],
  ],
  [
    'mock-bounty-accepted-unrated',
    [submission({ id: 'mock-accepted-submission', taskId: 'mock-bounty-accepted-unrated' })],
  ],
  [
    'mock-bounty-completed-rated',
    [submission({ id: 'mock-rated-submission', taskId: 'mock-bounty-completed-rated' })],
  ],
  [
    'mock-claim-claimed',
    [submission({ id: 'mock-claim-submission', taskId: 'mock-claim-claimed' })],
  ],
]);

const pitchesByTaskId = new Map<string, PitchResponse[]>([
  [
    'mock-pitch-open',
    [
      {
        estimatedDuration: 6,
        id: 'mock-pitch-1',
        pitchText: 'I will compare the protocol flows, map gaps, and ship a concise review pack.',
        status: 'pending',
        submittedAt: hoursFromNow(-3),
        taskId: 'mock-pitch-open',
        workerAddress: workerOne,
        workerAgentId: '1003',
        workerStats: { averageRating: 4.7, completedTasks: 18 },
      },
      {
        estimatedDuration: 10,
        id: 'mock-pitch-2',
        pitchText: 'I will produce a deeper UX teardown with screenshots and prioritized fixes.',
        status: 'pending',
        submittedAt: hoursFromNow(-2),
        taskId: 'mock-pitch-open',
        workerAddress: workerTwo,
        workerAgentId: '1004',
        workerStats: { averageRating: 4.4, completedTasks: 11 },
      },
    ],
  ],
  [
    'mock-pitch-selected',
    [
      {
        estimatedDuration: 10,
        id: 'mock-pitch-selected-1',
        pitchText:
          'Selected plan: create a traceable UX review with artifacts and acceptance notes.',
        status: 'selected',
        submittedAt: hoursFromNow(-12),
        taskId: 'mock-pitch-selected',
        workerAddress: workerTwo,
        workerAgentId: '1004',
      },
    ],
  ],
]);

const proofsByTaskId = new Map<string, ProofResponse[]>([
  [
    'mock-benchmark-open',
    [
      {
        id: 'mock-proof-1',
        metricValue: 'p95=118ms',
        proofData: 'https://mock.taskmarket.local/proofs/latency-run-118ms.json',
        proofType: 'eval',
        status: 'verified',
        submittedAt: hoursFromNow(-4),
        taskId: 'mock-benchmark-open',
        workerAddress: workerThree,
        workerAgentId: '1005',
      },
    ],
  ],
]);

const bidsByTaskId = new Map<string, BidResponse[]>([
  [
    'mock-auction-english-open',
    [
      {
        createdAt: hoursFromNow(-4),
        id: 'bid-english-1',
        price: '760000000',
        taskId: 'mock-auction-english-open',
        workerAddress: workerOne,
        workerAgentId: '1003',
      },
      {
        createdAt: hoursFromNow(-3),
        id: 'bid-english-2',
        price: '640000000',
        taskId: 'mock-auction-english-open',
        workerAddress: workerTwo,
        workerAgentId: '1004',
      },
      {
        createdAt: hoursFromNow(-2),
        id: 'bid-english-3',
        price: '600000000',
        taskId: 'mock-auction-english-open',
        workerAddress: workerThree,
        workerAgentId: '1005',
      },
    ],
  ],
  [
    'mock-auction-english-select-winner',
    [
      {
        createdAt: hoursFromNow(-24),
        id: 'bid-select-1',
        price: '620000000',
        taskId: 'mock-auction-english-select-winner',
        workerAddress: workerOne,
        workerAgentId: '1003',
      },
      {
        createdAt: hoursFromNow(-22),
        id: 'bid-select-2',
        price: '520000000',
        taskId: 'mock-auction-english-select-winner',
        workerAddress: workerTwo,
        workerAgentId: '1004',
      },
    ],
  ],
  [
    'mock-auction-reverse-english-open',
    [
      {
        createdAt: hoursFromNow(-2),
        id: 'bid-reverse-1',
        price: null,
        taskId: 'mock-auction-reverse-english-open',
        workerAddress: workerOne,
        workerAgentId: '1003',
      },
      {
        createdAt: hoursFromNow(-1),
        id: 'bid-reverse-2',
        price: null,
        taskId: 'mock-auction-reverse-english-open',
        workerAddress: workerTwo,
        workerAgentId: '1004',
      },
    ],
  ],
]);

const claimsByTaskId = new Map<string, ClaimResponse>([
  [
    'mock-claim-claimed',
    {
      claimedAt: hoursFromNow(-12),
      id: 'claim-1',
      stakeAmount: '32000000',
      stakeTxHash: '0xclaimstake',
      status: 'active',
      taskId: 'mock-claim-claimed',
      workerAddress: workerOne,
    },
  ],
]);

const agents: LeaderboardEntry[] = [
  {
    address: workerOne,
    agentId: '1003',
    averageRating: 4.7,
    completedTasks: 18,
    emailAddress: 'agent-three@example.com',
    rank: 1,
    skills: ['analysis', 'verification'],
    totalEarnings: '1825000000',
  },
  {
    address: workerTwo,
    agentId: '1004',
    averageRating: 4.4,
    completedTasks: 11,
    emailAddress: 'agent-four@example.com',
    rank: 2,
    skills: ['ux', 'research'],
    totalEarnings: '940000000',
  },
  {
    address: workerThree,
    agentId: '1005',
    averageRating: 4.2,
    completedTasks: 8,
    emailAddress: 'agent-five@example.com',
    rank: 3,
    skills: ['benchmark', 'latency'],
    totalEarnings: '720000000',
  },
];

const agentStats = new Map<string, AgentStats>(
  agents.map((agent) => [
    agent.agentId ?? agent.address,
    {
      ...agent,
      actorType: 'agent',
      ratedTasks: 12,
      recentRatings: [
        {
          createdAt: hoursFromNow(-36),
          feedbackText: 'Clear evidence pack and strong traceability back to the task brief.',
          rating: 94,
          taskId: 'mock-bounty-completed-rated',
          taskTitle: 'Bounty - completed and rated reference task.',
        },
      ],
      totalStars: 56,
    },
  ])
);

export const taskListResponse = {
  hasMore: false,
  nextCursor: null,
  tasks: tasks.map(taskPreview),
};

function taskPreview(taskDetail: TaskDetailResponse): TaskResponse {
  const { pendingActions, ...preview } = taskDetail;
  void pendingActions;
  return preview;
}

function filteredTasks(url: URL) {
  let filtered = tasks.map(taskPreview);
  const status = url.searchParams.get('status');
  const mode = url.searchParams.get('mode');
  const auctionType = url.searchParams.get('auctionType');
  const actorType = url.searchParams.get('requesterActorType');
  const tags = url.searchParams
    .getAll('tags')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);
  const minReward = url.searchParams.get('minReward');
  const maxReward = url.searchParams.get('maxReward');
  const deadlineHours = url.searchParams.get('deadlineHours');

  if (status && status !== 'ALL') {
    filtered = filtered.filter((taskItem) => taskItem.status === status);
  }
  if (mode && mode !== 'ALL') {
    filtered = filtered.filter((taskItem) => taskItem.mode === mode);
  }
  if (auctionType) {
    filtered = filtered.filter((taskItem) => taskItem.auctionType === auctionType);
  }
  if (actorType) {
    filtered = filtered.filter((taskItem) => taskItem.requesterActorType === actorType);
  }
  if (tags.length > 0) {
    filtered = filtered.filter((taskItem) => tags.every((tag) => taskItem.tags.includes(tag)));
  }
  if (minReward) {
    filtered = filtered.filter((taskItem) => BigInt(taskItem.reward) >= BigInt(minReward));
  }
  if (maxReward) {
    filtered = filtered.filter((taskItem) => BigInt(taskItem.reward) <= BigInt(maxReward));
  }
  if (deadlineHours) {
    const cutoff = Date.now() + Number(deadlineHours) * 60 * 60 * 1000;
    filtered = filtered.filter((taskItem) => new Date(taskDeadline(taskItem)).getTime() <= cutoff);
  }

  return {
    hasMore: false,
    nextCursor: null,
    tasks: filtered,
  };
}

function filteredTasksFromInput(input: unknown) {
  const url = new URL('http://mock.local/api/tasks');

  if (typeof input === 'object' && input !== null) {
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        value.forEach((item) => url.searchParams.append(key, String(item)));
      } else if (value !== null && value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  return filteredTasks(url);
}

function taskDeadline(taskItem: TaskResponse) {
  if (taskItem.mode === 'auction' && taskItem.bidDeadline) return taskItem.bidDeadline;
  if (taskItem.mode === 'pitch' && taskItem.pitchDeadline) return taskItem.pitchDeadline;
  return taskItem.expiryTime;
}

function findArtifact(artifactId: string) {
  for (const submissions of submissionsByTaskId.values()) {
    for (const item of submissions) {
      const found = item.artifacts?.find((artifactItem) => artifactItem.id === artifactId);
      if (found) return found;
    }
  }

  return null;
}

function mockPreviewUrl(artifactItem: ArtifactResponse) {
  if (artifactItem.mediaKind === 'image') {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">',
      '<rect width="640" height="360" fill="#f6f3ef"/>',
      '<rect x="42" y="42" width="556" height="276" rx="18" fill="#ffffff" stroke="#d7d0c7"/>',
      '<text x="72" y="118" fill="#1f1b16" font-family="Arial, sans-serif" font-size="34" font-weight="700">Taskmarket artifact</text>',
      `<text x="72" y="168" fill="#6f665c" font-family="Arial, sans-serif" font-size="22">${artifactItem.fileName}</text>`,
      '</svg>',
    ].join('');
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  return `https://files.example.com/mock/${encodeURIComponent(artifactItem.fileName)}`;
}

function submissionsForResponse(taskId: string, includePreviewUrls: boolean) {
  const submissions = submissionsByTaskId.get(taskId) ?? [];

  if (!includePreviewUrls) {
    return submissions;
  }

  return submissions.map((submissionItem) => ({
    ...submissionItem,
    artifacts: (submissionItem.artifacts ?? []).map((artifactItem) =>
      artifactItem.mediaKind === 'image' || artifactItem.mediaKind === 'video'
        ? {
            ...artifactItem,
            previewExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
            previewUrl: mockPreviewUrl(artifactItem),
          }
        : artifactItem
    ),
  }));
}

function writeJson(serverResponse: ServerResponse, body: unknown, status = 200) {
  serverResponse.writeHead(status, {
    'access-control-allow-headers': 'content-type, x-trpc-source',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-origin': '*',
    'content-type': 'application/json',
  });
  serverResponse.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
  }
  return body;
}

function trpcInput(url: URL, body: unknown, index: number) {
  const rawInput = requestInput(url, body);
  if (!rawInput) return {};

  const indexed = rawInput[String(index)] as { json?: unknown } | undefined;
  if (indexed?.json) return indexed.json;

  if (typeof rawInput === 'object' && rawInput !== null && 'json' in rawInput) {
    return (rawInput as { json: unknown }).json;
  }

  return rawInput;
}

function requestInput(url: URL, body: unknown) {
  const inputParam = url.searchParams.get('input');
  if (inputParam) {
    return JSON.parse(inputParam) as Record<string, unknown>;
  }
  if (body && typeof body === 'object' && 'input' in body) {
    return (body as { input?: unknown }).input as Record<string, unknown>;
  }
  return body as Record<string, unknown>;
}

function dataForProcedure(procedure: string, input: unknown) {
  const taskId =
    typeof input === 'object' && input !== null && 'taskId' in input
      ? String((input as { taskId?: unknown }).taskId)
      : '';

  switch (procedure) {
    case 'tasks.list':
      return filteredTasksFromInput(input);
    case 'claims.getByTask':
      return claimsByTaskId.get(taskId) ?? null;
    case 'pitches.listByTask':
      return pitchesByTaskId.get(taskId) ?? [];
    case 'proofs.listByTask':
      return proofsByTaskId.get(taskId) ?? [];
    default:
      return null;
  }
}

async function handleTrpc(request: IncomingMessage, response: ServerResponse, url: URL) {
  const bodyText = request.method === 'POST' ? await readBody(request) : '';
  const body = bodyText ? (JSON.parse(bodyText) as unknown) : null;
  const procedures = url.pathname
    .replace(/^\/trpc\/?/, '')
    .split(',')
    .filter(Boolean);
  const isBatch = url.searchParams.get('batch') === '1' || procedures.length > 1;
  const results = procedures.map((procedure, index) => ({
    result: {
      data: dataForProcedure(procedure, trpcInput(url, body, index)),
    },
  }));

  writeJson(response, isBatch ? results : (results[0] ?? { result: { data: { json: null } } }));
}

export async function startMockApiServer(
  port = Number(process.env.E2E_MOCK_API_PORT ?? process.env.TASKMARKET_MOCK_API_PORT ?? 3101)
) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);

    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'access-control-allow-headers': 'content-type, x-trpc-source',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-origin': '*',
      });
      response.end();
      return;
    }

    if (url.pathname.startsWith('/trpc')) {
      await handleTrpc(request, response, url);
      return;
    }

    if (url.pathname === '/api/tasks/stats') {
      writeJson(response, {
        count: tasks.length,
        totalRewards: tasks
          .reduce((total, taskItem) => total + BigInt(taskItem.reward), 0n)
          .toString(),
      });
      return;
    }

    if (url.pathname === '/api/agents/count') {
      writeJson(response, { count: agents.length });
      return;
    }

    if (url.pathname === '/api/agents/leaderboard') {
      writeJson(response, agents);
      return;
    }

    if (url.pathname === '/api/agents/stats') {
      const agentId = url.searchParams.get('agentId');
      const address = url.searchParams.get('address');
      const stats =
        (agentId ? agentStats.get(agentId) : null) ??
        agents.find((agent) => agent.address.toLowerCase() === address?.toLowerCase()) ??
        null;
      writeJson(response, stats ?? { error: 'Not found' }, stats ? 200 : 404);
      return;
    }

    if (url.pathname === '/api/tasks') {
      writeJson(response, filteredTasks(url));
      return;
    }

    const previewMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/artifacts\/([^/]+)\/preview$/);
    if (previewMatch) {
      const artifactItem = findArtifact(decodeURIComponent(previewMatch[2] ?? ''));
      writeJson(
        response,
        artifactItem
          ? {
              previewUrl: `https://files.example.com/mock/${encodeURIComponent(artifactItem.fileName)}`,
            }
          : { error: 'Not found' },
        artifactItem ? 200 : 404
      );
      return;
    }

    const submissionsMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/submissions$/);
    if (submissionsMatch) {
      writeJson(
        response,
        submissionsForResponse(
          decodeURIComponent(submissionsMatch[1] ?? ''),
          url.searchParams.get('includePreviewUrls') === 'media'
        )
      );
      return;
    }

    const pitchesMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/pitches$/);
    if (pitchesMatch) {
      writeJson(response, pitchesByTaskId.get(decodeURIComponent(pitchesMatch[1] ?? '')) ?? []);
      return;
    }

    const proofsMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/proofs$/);
    if (proofsMatch) {
      writeJson(response, proofsByTaskId.get(decodeURIComponent(proofsMatch[1] ?? '')) ?? []);
      return;
    }

    const bidsMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/bids$/);
    if (bidsMatch) {
      writeJson(response, bidsByTaskId.get(decodeURIComponent(bidsMatch[1] ?? '')) ?? []);
      return;
    }

    const claimMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/claim$/);
    if (claimMatch) {
      writeJson(response, claimsByTaskId.get(decodeURIComponent(claimMatch[1] ?? '')) ?? null);
      return;
    }

    const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskMatch) {
      const taskItem = tasks.find((item) => item.id === decodeURIComponent(taskMatch[1] ?? ''));
      writeJson(response, taskItem ?? { error: 'Not found' }, taskItem ? 200 : 404);
      return;
    }

    writeJson(response, { error: 'Not found' }, 404);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(
    process.env.E2E_MOCK_API_PORT ?? process.env.TASKMARKET_MOCK_API_PORT ?? 3101
  );
  const server = await startMockApiServer(port);
  console.log(`Taskmarket mock API listening on http://127.0.0.1:${port}`);
  console.log('Mock task IDs:');
  for (const taskItem of tasks) {
    console.log(`- ${taskItem.id} (${taskItem.mode}/${taskItem.status})`);
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      await server.close();
      process.exit(0);
    });
  }
}

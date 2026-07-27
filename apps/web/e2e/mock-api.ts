import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import type {
  ActivityFeedResponse,
  AgentStats,
  AgentTimeSeriesResponse,
  ArtifactMediaKindValue,
  ArtifactResponse,
  ArtifactRoleValue,
  BidResponse,
  BreakdownsResponse,
  ClaimResponse,
  LeaderboardEntry,
  LegalBundle,
  PendingAction,
  PitchResponse,
  PlatformTimeSeriesResponse,
  ProofResponse,
  SubmissionResponse,
  TaskDetailResponse,
  TaskDropDirectoryResponse,
  TaskDropPageData,
  TaskModeType,
  TaskResponse,
} from '@taskmarket/shared';

const requester = '0x8f12A4c661F9b365D408bF4a3Dd079fd9a5E2011';
const workerOne = '0x3333333333333333333333333333333333333333';
const workerTwo = '0x4444444444444444444444444444444444444444';
const workerThree = '0x5555555555555555555555555555555555555555';
const now = new Date('2026-05-13T00:00:00.000Z').toISOString();
const legalBundle = {
  acceptanceAvailable: false,
  acceptanceStatement: 'I accept the Taskmarket legal terms.',
  bundleDigest: `sha256:${'a'.repeat(64)}`,
  documents: [
    {
      contentHash: `sha256:${'b'.repeat(64)}`,
      slug: 'terms',
      summary: 'Taskmarket terms for browser regression tests.',
      title: 'Terms of Service',
      type: 'terms_of_service',
      url: 'https://taskmarket.dev/legal/terms',
      version: 'e2e-1',
    },
  ],
  effectiveAt: null,
  enforcementEnabled: false,
  privyAppId: null,
  publishedAt: now,
  status: 'draft',
  version: 'e2e-1',
} satisfies LegalBundle;

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
    awardCount: 0,
    awards: [],
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
    primaryAward: null,
    requester,
    requesterActorType: 'human',
    requesterAgentId: null,
    requesterPubkey: requester,
    reward: '240000000',
    stakeBps: 0,
    stakeRequired: false,
    status: 'open',
    submissionCount: 0,
    submissionWindowOpen: true,
    phase: 'active',
    tags: ['mock'],
    taskVisibility: 'public',
    submissionVisibility: 'public',
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
    description:
      'Bounty - open submission pool for settlement receipt review.\nREFERENCE: https://raw.githubusercontent.com/taskmarket/research/7ba0f258954455441a7bd3d21ca19049e4c831f7a4db7777e6df3fbd9f30d48d/raw/guide.md',
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
    taskDropId: 'launch-drop',
  }),
  task({
    description: 'Bounty - unlisted task, reachable by direct link only (ADR-0014).',
    id: 'mock-bounty-unlisted',
    mode: 'bounty',
    pendingActions: [
      action('mock-bounty-unlisted', 'requester', 'cancel'),
      action('mock-bounty-unlisted', 'requester', 'update'),
    ],
    reward: '240000000',
    submissionCount: 0,
    tags: ['bounty', 'unlisted'],
    taskVisibility: 'unlisted',
    submissionVisibility: 'public',
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
    awardCount: 1,
    description: 'Bounty - accepted deliverable waiting for requester rating.',
    id: 'mock-bounty-accepted-unrated',
    mode: 'bounty',
    pendingActions: [action('mock-bounty-accepted-unrated', 'requester', 'rate')],
    primaryAward: { workerAddress: workerOne, rating: null },
    status: 'completed',
    submissionCount: 1,
    tags: ['bounty', 'rating'],
    workerAgentId: '1003',
  }),
  task({
    awardCount: 1,
    description: 'Bounty - completed and rated reference task.',
    id: 'mock-bounty-completed-rated',
    mode: 'bounty',
    primaryAward: { workerAddress: workerOne, rating: 94 },
    status: 'completed',
    submissionCount: 1,
    tags: ['bounty', 'complete'],
    workerAgentId: '1003',
  }),
  task({
    awardCount: 3,
    awards: [
      {
        workerAddress: workerOne,
        workerAgentId: '1003',
        workerActorType: 'agent',
        rank: 1,
        isPrimary: true,
        grossAmount: '2000000',
        workerPayment: '1900000',
        platformFee: '100000',
        settlementTxHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
        settledAt: now,
        rating: 96,
      },
      {
        workerAddress: workerTwo,
        workerAgentId: '1004',
        workerActorType: 'agent',
        rank: 2,
        isPrimary: false,
        grossAmount: '1200000',
        workerPayment: '1140000',
        platformFee: '60000',
        settlementTxHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
        settledAt: now,
        rating: null,
      },
      {
        workerAddress: workerThree,
        workerAgentId: null,
        workerActorType: 'human',
        rank: 3,
        isPrimary: false,
        grossAmount: '800000',
        workerPayment: '760000',
        platformFee: '40000',
        settlementTxHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
        settledAt: now,
        rating: null,
      },
    ],
    description: 'Bounty - split settlement across three award recipients.',
    id: 'mock-bounty-split-settlement',
    mode: 'bounty',
    pendingActions: [workerTwo, workerThree].map((targetWorker) => ({
      action: 'rate' as const,
      command: `taskmarket task rate mock-bounty-split-settlement --worker ${targetWorker} --rating <0-100>`,
      role: 'requester' as const,
      targetWorker,
    })),
    primaryAward: { workerAddress: workerOne, rating: 96 },
    reward: '4000000',
    status: 'completed',
    tags: ['bounty', 'split'],
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
    claimedBy: workerTwo,
    reward: '420000000',
    status: 'worker_selected',
    tags: ['pitch', 'selected'],
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
            fileName: 'candidate-a-calculator.html',
            id: 'e2e-artifact-html',
            mediaKind: 'text',
            mimeType: 'text/html',
            role: 'preview',
            submissionId: 'e2e-submission-1',
            taskId: 'e2e-pending-review',
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
        submissionId: 'mock-proof-submission-1',
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

// ---------------------------------------------------------------------------
// Stats fixtures (power the stats.* chart endpoints so the dashboard and agent
// pages render populated charts rather than empty fallbacks).
// ---------------------------------------------------------------------------

const STATS_DAYS = 90;
const statsAnchorMs = new Date('2026-05-13T00:00:00.000Z').getTime();

function isoDayAgo(daysAgo: number) {
  return new Date(statsAnchorMs - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Deterministic wavy upward trend (no randomness, stable across runs).
const platformSeriesAll: PlatformTimeSeriesResponse = Array.from({ length: STATS_DAYS }, (_, i) => {
  const tasksCreated = Math.max(0, 2 + Math.round(3 * Math.sin(i / 6) + i / 14));
  const completedTasks = Math.max(0, tasksCreated - 1 - (i % 2));
  const newAgents = i % 5 === 0 ? 1 + (i % 3) : 0;
  const activeAgents = Math.max(1, Math.round(tasksCreated * 0.75));
  return {
    activeAgents,
    bucket: isoDayAgo(STATS_DAYS - 1 - i),
    completedTasks,
    newAgents,
    rewardVolume: (BigInt(tasksCreated) * 240000000n).toString(),
    tasksCreated,
  };
});

function platformSeriesForRange(range: string | null): PlatformTimeSeriesResponse {
  const span = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : STATS_DAYS;
  return platformSeriesAll.slice(Math.max(0, platformSeriesAll.length - span));
}

const breakdownsResponse: BreakdownsResponse = {
  actorType: [
    { actorType: 'human', count: 14 },
    { actorType: 'agent', count: 32 },
  ],
  mode: [
    { count: 18, mode: 'bounty' },
    { count: 9, mode: 'claim' },
    { count: 7, mode: 'pitch' },
    { count: 4, mode: 'benchmark' },
    { count: 8, mode: 'auction' },
  ],
  status: [
    { count: 12, status: 'open' },
    { count: 4, status: 'claimed' },
    { count: 2, status: 'worker_selected' },
    { count: 3, status: 'pending_approval' },
    { count: 21, status: 'completed' },
    { count: 1, status: 'disputed' },
    { count: 2, status: 'expired' },
    { count: 1, status: 'cancelled' },
  ],
};

function buildHeatmap(dimension: string) {
  if (dimension === 'hourOfWeek') {
    const rowKeys = ['0', '1', '2', '3', '4', '5', '6'];
    const colKeys = Array.from({ length: 24 }, (_, h) => String(h));
    const cells: Array<{ row: string; col: string; count: number; volume: string }> = [];
    let maxCount = 0;
    for (const r of rowKeys) {
      for (const c of colKeys) {
        const count = (Number(r) * 7 + Number(c) * 3) % 11;
        if (count === 0) continue;
        maxCount = Math.max(maxCount, count);
        cells.push({ col: c, count, row: r, volume: '0' });
      }
    }
    return { cells, colKeys, maxCount, rowKeys };
  }
  const rowKeys = ['bounty', 'claim', 'pitch', 'benchmark', 'auction'];
  const colKeys = Array.from({ length: 14 }, (_, i) => {
    const d = new Date('2026-06-21T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - (13 - i));
    return d.toISOString().slice(0, 10);
  });
  const cells: Array<{ row: string; col: string; count: number; volume: string }> = [];
  let maxCount = 0;
  rowKeys.forEach((row, ri) => {
    colKeys.forEach((col, ci) => {
      const count = (ri * 5 + ci * 2 + 1) % 9;
      if (count === 0) return;
      maxCount = Math.max(maxCount, count);
      cells.push({ col, count, row, volume: String(count * 40_000_000) });
    });
  });
  return { cells, colKeys, maxCount, rowKeys };
}

const activityFeedItems: ActivityFeedResponse['items'] = [
  {
    actor: requester,
    actorType: 'human',
    amount: '240000000',
    rating: null,
    taskId: 'mock-bounty-open',
    taskTitle: 'Bounty - open submission pool for settlement receipt review.',
    timestamp: hoursFromNow(-0.3),
    type: 'task_created',
  },
  {
    actor: workerOne,
    actorType: 'agent',
    amount: null,
    rating: null,
    taskId: 'e2e-pending-review',
    taskTitle: 'Bounty - pending requester review with multiple submissions.',
    timestamp: hoursFromNow(-1.2),
    type: 'task_submitted',
  },
  {
    actor: requester,
    actorType: 'human',
    amount: null,
    rating: 94,
    taskId: 'mock-bounty-completed-rated',
    taskTitle: 'Bounty - completed and rated reference task.',
    timestamp: hoursFromNow(-2.4),
    type: 'task_rated',
  },
  {
    actor: workerTwo,
    actorType: 'agent',
    amount: '600000000',
    rating: null,
    taskId: 'mock-auction-english-open',
    taskTitle: 'Auction - English open undercutting with visible bids.',
    timestamp: hoursFromNow(-3.1),
    type: 'bid_placed',
  },
  {
    actor: workerOne,
    actorType: 'agent',
    amount: '32000000',
    rating: null,
    taskId: 'mock-claim-claimed',
    taskTitle: 'Claim - worker has reserved the task and can submit work.',
    timestamp: hoursFromNow(-5.6),
    type: 'task_claimed',
  },
  {
    actor: workerTwo,
    actorType: 'agent',
    amount: null,
    rating: null,
    taskId: 'mock-pitch-open',
    taskTitle: 'Pitch - requester compares proposals before selecting a worker.',
    timestamp: hoursFromNow(-8),
    type: 'task_pitched',
  },
  {
    actor: requester,
    actorType: 'human',
    amount: '510000000',
    rating: null,
    taskId: 'mock-benchmark-open',
    taskTitle: 'Benchmark - workers submit measurable proof against a target metric.',
    timestamp: hoursFromNow(-11),
    type: 'task_created',
  },
  {
    actor: requester,
    actorType: 'human',
    amount: null,
    rating: 88,
    taskId: 'mock-bounty-accepted-unrated',
    taskTitle: 'Bounty - accepted deliverable waiting for requester rating.',
    timestamp: hoursFromNow(-15),
    type: 'task_rated',
  },
];

// Honour the `types` filter so the News segment chips work in mock-web.
function activityFeedFor(input: unknown): ActivityFeedResponse {
  const types =
    typeof input === 'object' &&
    input !== null &&
    Array.isArray((input as { types?: unknown }).types)
      ? ((input as { types: string[] }).types ?? [])
      : [];
  const items = types.length
    ? activityFeedItems.filter((item) => types.includes(item.type))
    : activityFeedItems;
  return { items, nextCursor: null };
}

// Per-agent weekly series: cumulative earnings climb, some empty/early weeks,
// a couple of null-rating weeks so the rating line shows honest gaps.
function agentSeries(): AgentTimeSeriesResponse {
  let cumulative = 0n;
  return Array.from({ length: 12 }, (_, i) => {
    const earnedThisWeek = i % 4 === 0 ? 0 : 1 + (i % 3);
    const earnings = BigInt(earnedThisWeek) * 120000000n;
    cumulative += earnings;
    const ratingsCount = i < 2 ? 0 : 1 + (i % 3);
    return {
      activityCount: earnedThisWeek + (i % 2),
      avgRating: ratingsCount === 0 ? null : 72 + ((i * 9) % 26),
      bucket: isoDayAgo((11 - i) * 7),
      cumulativeEarnings: cumulative.toString(),
      earnings: earnings.toString(),
      ratingsCount,
      tasksCompleted: earnedThisWeek,
    };
  });
}

const inboxResponse = {
  asRequester: tasks.slice(0, 6).map(taskPreview),
  asWorker: tasks
    .filter(
      (taskItem) =>
        taskItem.claimedBy === workerOne ||
        (taskItem.awards ?? []).some((award) => award.workerAddress === workerOne)
    )
    .map(taskPreview),
};

export const taskListResponse = {
  hasMore: false,
  nextCursor: null,
  tasks: tasks.map(taskPreview),
};

export const taskDropDirectoryResponse = {
  items: [
    {
      availableTaskCount: 4,
      drop: {
        announcedAt: now,
        createdAt: now,
        description: 'Official launch work for agents across research, design, and engineering.',
        id: 'mock-official-drop',
        isOfficial: true,
        name: 'Official launch',
        officialWalletAddress: requester,
        ownerAddress: requester,
      },
      latestTaskAt: now,
      nextExpiryTime: hoursFromNow(72),
      resolvedTaskCount: 2,
      taskCount: 6,
      totalReward: '1440000000',
    },
    {
      availableTaskCount: 2,
      drop: {
        announcedAt: now,
        createdAt: now,
        description: 'Community-led market research and ecosystem mapping.',
        id: 'mock-community-drop',
        isOfficial: false,
        name: 'Ecosystem research',
        officialWalletAddress: workerOne,
        ownerAddress: workerOne,
      },
      latestTaskAt: now,
      nextExpiryTime: hoursFromNow(120),
      resolvedTaskCount: 1,
      taskCount: 3,
      totalReward: '720000000',
    },
  ],
  nextCursor: null,
} satisfies TaskDropDirectoryResponse;

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
  const taskDropId = url.searchParams.get('taskDropId');

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
  if (taskDropId) {
    filtered = filtered.filter((taskItem) => taskItem.taskDropId === taskDropId);
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

  if (artifactItem.mediaKind === 'video') {
    // Minimal ftyp box as a data URL — avoids any DNS resolution in CI.
    // Media decode errors from invalid data do not surface as console.error.
    return 'data:video/mp4;base64,AAAAHGZ0eXBNNFYgAAACAGlzb20=';
  }

  if (
    artifactItem.mimeType.toLowerCase().split(';', 1)[0] === 'text/html' ||
    /\.html?$/i.test(artifactItem.fileName)
  ) {
    const html = `<!doctype html>
      <html>
        <head>
          <style>
            body { font-family: sans-serif; padding: 24px; }
            label, output, button { display: block; margin-top: 12px; }
          </style>
        </head>
        <body>
          <h1>Submission calculator</h1>
          <label>First number <input id="first-number" value="2"></label>
          <label>Second number <input id="second-number" value="3"></label>
          <button id="calculate" type="button">Add numbers</button>
          <output id="calculator-result" aria-live="polite"></output>
          <p id="parent-isolation"></p>
          <p id="network-isolation"></p>
          <script>
            document.querySelector('#calculate').addEventListener('click', () => {
              const first = Number(document.querySelector('#first-number').value);
              const second = Number(document.querySelector('#second-number').value);
              document.querySelector('#calculator-result').textContent = String(first + second);
            });

            try {
              window.parent.document.body;
              document.querySelector('#parent-isolation').textContent = 'Parent access allowed';
            } catch {
              document.querySelector('#parent-isolation').textContent = 'Parent access blocked';
            }

            fetch('https://preview-network-block.test/ping')
              .then(() => {
                document.querySelector('#network-isolation').textContent = 'Network access allowed';
              })
              .catch(() => {
                document.querySelector('#network-isolation').textContent = 'Network access blocked';
              });
          </script>
        </body>
      </html>`;
    return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  }

  return undefined;
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

  // Batched input is keyed by the call index. The value is either superjson-
  // wrapped ({ json: <input> }) or the plain input object, depending on the
  // client transformer. Unwrap both so procedures see the actual input.
  const indexed = rawInput[String(index)] as { json?: unknown } | undefined;
  if (indexed !== undefined && indexed !== null) {
    return (indexed as { json?: unknown }).json ?? indexed;
  }

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

  const range =
    typeof input === 'object' && input !== null && 'range' in input
      ? String((input as { range?: unknown }).range)
      : null;
  const agentKey =
    typeof input === 'object' && input !== null
      ? String(
          (input as { agentId?: unknown }).agentId ?? (input as { address?: unknown }).address ?? ''
        )
      : '';
  const taskDropId =
    typeof input === 'object' && input !== null && 'taskDropId' in input
      ? String((input as { taskDropId?: unknown }).taskDropId)
      : '';

  switch (procedure) {
    case 'tasks.list':
      return filteredTasksFromInput(input);
    case 'taskDrops.get': {
      const directoryItem = taskDropDirectoryResponse.items.find(
        (item) => item.drop.id === taskDropId
      );
      if (!directoryItem) return null;

      return {
        drop: directoryItem.drop,
        tasks: tasks.slice(0, 6).map((taskItem) => ({
          createdAt: taskItem.createdAt,
          description: taskItem.description,
          expiryTime: taskItem.expiryTime,
          id: taskItem.id,
          mode: taskItem.mode,
          reward: taskItem.reward,
          status: taskItem.status,
          tags: taskItem.tags,
        })),
      } satisfies TaskDropPageData;
    }
    case 'claims.getByTask':
      return claimsByTaskId.get(taskId) ?? null;
    case 'pitches.listByTask':
      return pitchesByTaskId.get(taskId) ?? [];
    case 'proofs.listByTask':
      return proofsByTaskId.get(taskId) ?? [];
    case 'stats.platformTimeSeries':
      return platformSeriesForRange(range);
    case 'stats.breakdowns':
      return breakdownsResponse;
    case 'stats.activityFeed':
      return activityFeedFor(input);
    case 'stats.agentTimeSeries':
      return agentSeries();
    case 'stats.activityHeatmap':
      return buildHeatmap('mode');
    case 'agents.inbox':
      return inboxResponse;
    case 'agents.stats':
      return agentStats.get(agentKey) ?? agentStats.get('1003') ?? null;
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

    if (url.pathname === '/api/legal/current') {
      writeJson(response, legalBundle);
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

    if (url.pathname === '/api/market/stats') {
      writeJson(response, {
        activeAgents7d: 4,
        activeWorkers7d: 3,
        openTasks: tasks.filter((taskItem) => taskItem.status === 'open').length,
        registeredWorkers: agents.length,
      });
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

    if (url.pathname === '/api/stats/platform-time-series') {
      writeJson(response, platformSeriesForRange(url.searchParams.get('range')));
      return;
    }

    if (url.pathname === '/api/stats/breakdowns') {
      writeJson(response, breakdownsResponse);
      return;
    }

    if (url.pathname === '/api/stats/activity-feed') {
      const limit = Number(url.searchParams.get('limit') ?? activityFeedItems.length);
      const types = url.searchParams.getAll('types');
      const filtered = activityFeedFor({ types });
      writeJson(response, {
        items: filtered.items.slice(0, limit),
        nextCursor: null,
      });
      return;
    }

    if (url.pathname === '/api/stats/agent-time-series') {
      writeJson(response, agentSeries());
      return;
    }

    if (url.pathname === '/api/stats/activity-heatmap') {
      writeJson(response, buildHeatmap(url.searchParams.get('dimension') ?? 'mode'));
      return;
    }

    if (url.pathname === '/api/tasks') {
      writeJson(response, filteredTasks(url));
      return;
    }

    if (url.pathname === '/api/task-drops/directory') {
      writeJson(response, taskDropDirectoryResponse);
      return;
    }

    const previewMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/artifacts\/([^/]+)\/preview$/);
    if (previewMatch) {
      const artifactItem = findArtifact(decodeURIComponent(previewMatch[2] ?? ''));
      writeJson(
        response,
        artifactItem
          ? {
              previewUrl:
                mockPreviewUrl(artifactItem) ??
                `https://files.example.com/mock/${encodeURIComponent(artifactItem.fileName)}`,
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
      const taskId = decodeURIComponent(taskMatch[1] ?? '');
      // Sentinel id used by e2e to exercise the server-side error boundary.
      if (taskId === 'e2e-error') {
        writeJson(response, { error: 'Internal Server Error' }, 500);
        return;
      }
      const taskItem = tasks.find((item) => item.id === taskId);
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

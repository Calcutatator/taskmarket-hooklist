import type {
  AgentStats,
  BidResponse,
  ClaimResponse,
  LeaderboardEntry,
  PitchResponse,
  ProofResponse,
  SubmissionResponse,
  TaskDetailResponse,
  TaskListResponse,
  TaskResponse,
} from '@taskmarket/shared';
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@taskmarket/backend/src/router';

import { getServerApiBaseUrl } from '@/lib/api/config';

const apiUrl = getServerApiBaseUrl();

export class ApiConnectionError extends Error {
  readonly path: string;
  readonly status?: number;

  constructor(message: string, options: { cause?: unknown; path: string; status?: number }) {
    super(message);
    this.name = 'ApiConnectionError';
    this.cause = options.cause;
    this.path = options.path;
    this.status = options.status;
  }
}

type TaskStats = {
  count: number;
  totalRewards: string;
};

function isNextDynamicServerError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    error.digest === 'DYNAMIC_SERVER_USAGE'
  );
}

async function readJson<T>(path: string): Promise<T> {
  try {
    const response = await fetch(`${apiUrl}${path}`, {
      cache: 'no-store',
      headers: {
        accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new ApiConnectionError(`Taskmarket API request failed with ${response.status}`, {
        path,
        status: response.status,
      });
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiConnectionError) {
      throw error;
    }
    if (isNextDynamicServerError(error)) {
      throw error;
    }

    throw new ApiConnectionError('Taskmarket API request failed', {
      cause: error,
      path,
    });
  }
}

function makeServerTrpcClient() {
  return createTRPCProxyClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${apiUrl}/trpc`,
      }),
    ],
  });
}

async function trpcRead<T>(
  query: (client: ReturnType<typeof makeServerTrpcClient>) => Promise<T>,
  path: string
) {
  try {
    return await query(makeServerTrpcClient());
  } catch (error) {
    throw new ApiConnectionError('Taskmarket tRPC request failed', {
      cause: error,
      path,
    });
  }
}

export async function fetchTaskStats() {
  return readJson<TaskStats>('/api/tasks/stats');
}

export async function fetchAgentCount() {
  const data = await readJson<{ count?: number }>('/api/agents/count');
  return data.count;
}

export async function fetchTasks(searchParams?: {
  status?: string;
  mode?: string;
  limit?: number;
  auctionType?: string;
  tags?: string[];
  minReward?: string;
  maxReward?: string;
  deadlineHours?: number;
}) {
  const params = new URLSearchParams();
  if (searchParams?.status) {
    params.set('status', searchParams.status);
  }
  if (searchParams?.mode) {
    params.set('mode', searchParams.mode);
  }
  if (searchParams?.limit) {
    params.set('limit', String(searchParams.limit));
  }
  if (searchParams?.auctionType) {
    params.set('auctionType', searchParams.auctionType);
  }
  if (searchParams?.tags?.length) {
    searchParams.tags.forEach((tag) => params.append('tags', tag));
  }
  if (searchParams?.minReward) {
    params.set('minReward', searchParams.minReward);
  }
  if (searchParams?.maxReward) {
    params.set('maxReward', searchParams.maxReward);
  }
  if (searchParams?.deadlineHours) {
    params.set('deadlineHours', String(searchParams.deadlineHours));
  }

  const query = params.toString();
  return readJson<TaskListResponse>(`/api/tasks${query ? `?${query}` : ''}`);
}

export async function fetchTask(taskId: string) {
  try {
    return await readJson<TaskDetailResponse>(`/api/tasks/${taskId}`);
  } catch (error) {
    if (error instanceof ApiConnectionError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function fetchTaskSubmissions(taskId: string) {
  return readJson<SubmissionResponse[]>(`/api/tasks/${taskId}/submissions`);
}

export async function fetchTaskBids(taskId: string) {
  return readJson<BidResponse[]>(`/api/tasks/${taskId}/bids`);
}

export async function fetchTaskPitches(taskId: string) {
  return trpcRead<PitchResponse[]>(
    (client) => client.pitches.listByTask.query({ taskId }),
    'pitches.listByTask'
  );
}

export async function fetchTaskProofs(taskId: string) {
  return trpcRead<ProofResponse[]>(
    (client) => client.proofs.listByTask.query({ taskId }),
    'proofs.listByTask'
  );
}

export async function fetchTaskClaim(taskId: string) {
  return trpcRead<ClaimResponse | null>(
    (client) => client.claims.getByTask.query({ taskId }),
    'claims.getByTask'
  );
}

export async function fetchTaskModeData(task: TaskDetailResponse | TaskResponse) {
  const [submissions, pitches, proofs, bids, claim] = await Promise.all([
    task.mode === 'bounty' || task.mode === 'claim' ? fetchTaskSubmissions(task.id) : [],
    task.mode === 'pitch' ? fetchTaskPitches(task.id) : [],
    task.mode === 'benchmark' ? fetchTaskProofs(task.id) : [],
    task.mode === 'auction' ? fetchTaskBids(task.id) : [],
    task.mode === 'claim' ? fetchTaskClaim(task.id) : null,
  ]);

  return { bids, claim, pitches, proofs, submissions };
}

export async function fetchLeaderboard(searchParams?: {
  limit?: number;
  offset?: number;
  sort?: 'reputation' | 'tasks';
  skill?: string;
  search?: string;
  minRating?: number;
  minTasks?: number;
  actorType?: 'agent' | 'human';
}) {
  const params = new URLSearchParams();
  if (searchParams?.limit) {
    params.set('limit', String(searchParams.limit));
  }
  if (searchParams?.offset) {
    params.set('offset', String(searchParams.offset));
  }
  if (searchParams?.sort) {
    params.set('sort', searchParams.sort);
  }
  if (searchParams?.skill) {
    params.set('skill', searchParams.skill);
  }
  if (searchParams?.search) {
    params.set('search', searchParams.search);
  }
  if (searchParams?.minRating) {
    params.set('minRating', String(searchParams.minRating));
  }
  if (searchParams?.minTasks) {
    params.set('minTasks', String(searchParams.minTasks));
  }
  if (searchParams?.actorType) {
    params.set('actorType', searchParams.actorType);
  }

  const query = params.toString();
  return readJson<LeaderboardEntry[]>(`/api/agents/leaderboard${query ? `?${query}` : ''}`);
}

export async function fetchAgentStats(input: { address?: string; agentId?: string }) {
  const params = new URLSearchParams();
  if (input.address) {
    params.set('address', input.address);
  }
  if (input.agentId) {
    params.set('agentId', input.agentId);
  }

  const query = params.toString();
  try {
    return await readJson<AgentStats>(`/api/agents/stats${query ? `?${query}` : ''}`);
  } catch (error) {
    if (error instanceof ApiConnectionError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export const fallbackTasks: TaskResponse[] = [
  {
    bidDeadline: null,
    claimedAt: null,
    claimedBy: null,
    createdAt: new Date(0).toISOString(),
    description: 'Summarize settlement data and flag duplicate task submissions.',
    escrowTxHash: '0xreference1',
    expiryTime: new Date(0).toISOString(),
    id: 'reference-1',
    maxPrice: null,
    metricDescription: null,
    metricTarget: null,
    mode: 'bounty',
    platformFeeBps: 250,
    pitchDeadline: null,
    rating: null,
    requester: '0x8f12A4c661F9b365D408bF4a3Dd079fd9a5E2011',
    requesterPubkey: '0x8f12A4c661F9b365D408bF4a3Dd079fd9a5E2011',
    reward: '240000000',
    pitchCount: 0,
    status: 'open',
    stakeBps: 0,
    stakeRequired: false,
    submissionCount: 0,
    tags: ['analysis', 'verification'],
    worker: null,
  },
  {
    auctionBidCount: 3,
    auctionType: 'english',
    bidDeadline: null,
    claimedAt: null,
    claimedBy: null,
    createdAt: new Date(0).toISOString(),
    description: 'Build a typed parser for agent capability manifests.',
    escrowTxHash: '0xreference2',
    expiryTime: new Date(0).toISOString(),
    id: 'reference-2',
    maxPrice: null,
    metricDescription: null,
    metricTarget: null,
    mode: 'auction',
    platformFeeBps: 250,
    pitchDeadline: null,
    rating: null,
    requester: '0x597b0e7F366D9f985E03C8BdaF014C96a5985e4B',
    requesterPubkey: '0x597b0e7F366D9f985E03C8BdaF014C96a5985e4B',
    reward: '850000000',
    pitchCount: 0,
    status: 'open',
    stakeBps: 0,
    stakeRequired: false,
    submissionCount: 0,
    tags: ['typescript', 'agents'],
    worker: null,
  },
  {
    bidDeadline: null,
    claimedAt: null,
    claimedBy: null,
    createdAt: new Date(0).toISOString(),
    description: 'Review marketplace flows and prepare a conversion audit.',
    escrowTxHash: '0xreference3',
    expiryTime: new Date(0).toISOString(),
    id: 'reference-3',
    maxPrice: null,
    metricDescription: null,
    metricTarget: null,
    mode: 'pitch',
    platformFeeBps: 250,
    pitchDeadline: null,
    rating: null,
    requester: '0x3f6AB9167bb68d542D7936073f2252a77074A2f1',
    requesterPubkey: '0x3f6AB9167bb68d542D7936073f2252a77074A2f1',
    reward: '1200000000',
    pitchCount: 0,
    status: 'open',
    stakeBps: 0,
    stakeRequired: false,
    submissionCount: 0,
    tags: ['ux', 'marketplace'],
    worker: null,
  },
];

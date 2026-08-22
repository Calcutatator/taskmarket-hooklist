import type {
  ActivityFeedResponse,
  ActivityHeatmapResponse,
  ActivityType,
  AgentStats,
  AgentTimeSeriesResponse,
  AgentWorkResponse,
  BidResponse,
  BreakdownsResponse,
  Bucket,
  ClaimResponse,
  HeatmapDimension,
  HookIndexEntry,
  HookIndexResponse,
  LeaderboardEntry,
  PitchResponse,
  PlatformTimeSeriesResponse,
  ProofResponse,
  RequesterStats,
  SubmissionResponse,
  TaskDropDirectoryResponse,
  TaskDropPageData,
  TaskDetailResponse,
  TaskListResponse,
  TaskResponse,
  TimeRange,
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

export type MarketStats = {
  registeredWorkers: number;
  activeWorkers7d: number;
  activeAgents7d?: number;
  openTasks: number;
};

// Fail fast when the backend is unreachable or slow so a down/hanging API can
// never block server-side rendering (callers already handle ApiConnectionError).
const SERVER_FETCH_TIMEOUT_MS = 8_000;

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
      signal: AbortSignal.timeout(SERVER_FETCH_TIMEOUT_MS),
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

export async function fetchHookIndex(searchParams?: { limit?: number }) {
  const params = new URLSearchParams();
  if (searchParams?.limit) params.set('limit', String(searchParams.limit));
  const query = params.toString();
  return readJson<HookIndexResponse>(`/api/hooks${query ? `?${query}` : ''}`);
}

export async function fetchHook(address: string) {
  return readJson<HookIndexEntry | null>(`/api/hooks/${encodeURIComponent(address)}`);
}

export async function fetchAgentCount() {
  const data = await readJson<{ count?: number }>('/api/agents/count');
  return data.count;
}

export async function fetchMarketStats() {
  return readJson<MarketStats>('/api/market/stats');
}

export async function fetchTasks(searchParams?: {
  status?: string;
  mode?: string;
  limit?: number;
  cursor?: string;
  auctionType?: string;
  requesterActorType?: 'agent' | 'human';
  tags?: string[];
  minReward?: string;
  maxReward?: string;
  deadlineHours?: number;
  requester?: string;
  taskDropId?: string;
  worker?: string;
  sort?: string;
  q?: string;
}) {
  const params = new URLSearchParams();
  if (searchParams?.status) {
    params.set('status', searchParams.status);
  }
  // ADR-0099. Just another listing parameter -- the backend applies it as one more condition on
  // the same query, so it composes with every filter below and inherits their visibility rules.
  if (searchParams?.q) {
    params.set('q', searchParams.q);
  }
  if (searchParams?.mode) {
    params.set('mode', searchParams.mode);
  }
  if (searchParams?.sort) {
    params.set('sort', searchParams.sort);
  }
  if (searchParams?.limit) {
    params.set('limit', String(searchParams.limit));
  }
  if (searchParams?.cursor) {
    params.set('cursor', searchParams.cursor);
  }
  if (searchParams?.auctionType) {
    params.set('auctionType', searchParams.auctionType);
  }
  if (searchParams?.requesterActorType) {
    params.set('requesterActorType', searchParams.requesterActorType);
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
  if (searchParams?.requester) {
    params.set('requester', searchParams.requester);
  }
  if (searchParams?.taskDropId) {
    params.set('taskDropId', searchParams.taskDropId);
  }
  if (searchParams?.worker) {
    params.set('worker', searchParams.worker);
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

export async function fetchTaskDrop(taskDropId: string) {
  try {
    return await trpcRead<TaskDropPageData | null>(
      (client) => client.taskDrops.get.query({ taskDropId }),
      `/trpc/taskDrops.get?taskDropId=${encodeURIComponent(taskDropId)}`
    );
  } catch (error) {
    if (error instanceof ApiConnectionError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function fetchTaskDropDirectory(searchParams?: { cursor?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (searchParams?.cursor) {
    params.set('cursor', searchParams.cursor);
  }
  if (searchParams?.limit) {
    params.set('limit', String(searchParams.limit));
  }

  const query = params.toString();
  return readJson<TaskDropDirectoryResponse>(
    `/api/task-drops/directory${query ? `?${query}` : ''}`
  );
}

export async function fetchTaskSubmissions(
  taskId: string,
  options?: { includePreviewUrls?: 'none' | 'media' }
) {
  const params = new URLSearchParams();
  if (options?.includePreviewUrls) {
    params.set('includePreviewUrls', options.includePreviewUrls);
  }
  const query = params.toString();
  return readJson<SubmissionResponse[]>(
    `/api/tasks/${taskId}/submissions${query ? `?${query}` : ''}`
  );
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
    task.mode === 'bounty' || task.mode === 'claim'
      ? fetchTaskSubmissions(task.id, { includePreviewUrls: 'media' })
      : [],
    task.mode === 'pitch' ? fetchTaskPitches(task.id) : [],
    task.mode === 'benchmark' ? fetchTaskProofs(task.id) : [],
    task.mode === 'auction' ? fetchTaskBids(task.id) : [],
    task.mode === 'claim' ? fetchTaskClaim(task.id) : null,
  ]);

  return { bids, claim, pitches, proofs, submissions };
}

export type TaskEvaluationIdentities = {
  disputeResolverAgentId: string | null;
  evaluatorAgentId: string | null;
};

// Identity is a nicety on the evaluation card, not its point -- the terms themselves are what
// a worker needs in order to decide. So each lookup is raced against a short budget and falls
// back to the raw address, the same way the detail routes already treat their decorative
// market stats. A slow or missing agents service must never delay or break the terms.
const IDENTITY_LOOKUP_TIMEOUT_MS = 1200;

async function agentIdFor(address?: string | null): Promise<string | null> {
  if (!address) {
    return null;
  }

  return Promise.race([
    fetchAgentStats({ address })
      .then((stats) => stats?.agentId ?? null)
      .catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), IDENTITY_LOOKUP_TIMEOUT_MS)),
  ]);
}

/**
 * Registered agent identities for a task's evaluator and dispute resolver, so the evaluation
 * card can name them rather than print raw hex. Both are null for a task with no evaluation
 * terms, and for parties who are not registered agents -- which is an ordinary case, not an
 * error.
 */
export async function fetchTaskEvaluationIdentities(
  task: TaskDetailResponse | TaskResponse
): Promise<TaskEvaluationIdentities> {
  const [evaluatorAgentId, disputeResolverAgentId] = await Promise.all([
    agentIdFor(task.evaluator),
    agentIdFor(task.disputeResolver),
  ]);

  return { disputeResolverAgentId, evaluatorAgentId };
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

export async function fetchPlatformTimeSeries(input?: { range?: TimeRange; bucket?: Bucket }) {
  const params = new URLSearchParams();
  if (input?.range) {
    params.set('range', input.range);
  }
  if (input?.bucket) {
    params.set('bucket', input.bucket);
  }

  const query = params.toString();
  return readJson<PlatformTimeSeriesResponse>(
    `/api/stats/platform-time-series${query ? `?${query}` : ''}`
  );
}

export async function fetchAgentTimeSeries(input: {
  address?: string;
  agentId?: string;
  range?: TimeRange;
  bucket?: Bucket;
}) {
  const params = new URLSearchParams();
  if (input.address) {
    params.set('address', input.address);
  }
  if (input.agentId) {
    params.set('agentId', input.agentId);
  }
  if (input.range) {
    params.set('range', input.range);
  }
  if (input.bucket) {
    params.set('bucket', input.bucket);
  }

  const query = params.toString();
  return readJson<AgentTimeSeriesResponse>(
    `/api/stats/agent-time-series${query ? `?${query}` : ''}`
  );
}

export async function fetchBreakdowns() {
  return readJson<BreakdownsResponse>('/api/stats/breakdowns');
}

export async function fetchActivityFeed(input?: {
  limit?: number;
  cursor?: string;
  types?: ActivityType[];
}) {
  const params = new URLSearchParams();
  if (input?.limit) {
    params.set('limit', String(input.limit));
  }
  if (input?.cursor) {
    params.set('cursor', input.cursor);
  }
  if (input?.types?.length) {
    input.types.forEach((type) => params.append('types', type));
  }

  const query = params.toString();
  return readJson<ActivityFeedResponse>(`/api/stats/activity-feed${query ? `?${query}` : ''}`);
}

export async function fetchActivityHeatmap(input?: {
  range?: TimeRange;
  dimension?: HeatmapDimension;
}) {
  const params = new URLSearchParams();
  if (input?.range) {
    params.set('range', input.range);
  }
  if (input?.dimension) {
    params.set('dimension', input.dimension);
  }

  const query = params.toString();
  return readJson<ActivityHeatmapResponse>(
    `/api/stats/activity-heatmap${query ? `?${query}` : ''}`
  );
}

export async function fetchAgentWork(address: string, limit?: number) {
  const params = new URLSearchParams();
  if (limit) {
    params.set('limit', String(limit));
  }

  const query = params.toString();
  return readJson<AgentWorkResponse>(`/api/agents/${address}/work${query ? `?${query}` : ''}`);
}

export async function fetchRequesterStats(address: string): Promise<RequesterStats> {
  return trpcRead(
    (client) => client.requester.stats.query({ address }),
    `/trpc/requester.stats?address=${address}`
  );
}

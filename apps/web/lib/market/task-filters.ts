import { compactAddress } from '@/lib/format';

export type TaskSearchParams = {
  actor?: string;
  deadlineHours?: string;
  maxReward?: string;
  minReward?: string;
  mode?: string;
  requester?: string;
  status?: string;
  tags?: string;
  worker?: string;
};

export type ActiveFilter = {
  label: string;
  value: string;
};

export type ParsedTaskFilters = {
  activeFilters: ActiveFilter[];
  actor?: 'agent' | 'human';
  deadlineHours?: number;
  maxReward?: string;
  minReward?: string;
  mode?: string;
  requester?: string;
  selectedActor: 'ALL' | 'agent' | 'human';
  selectedMode: string;
  selectedStatus: string;
  status?: string;
  tags?: string[];
  worker?: string;
};

function labelize(value: string) {
  return value.replaceAll('_', ' ');
}

function toBaseUnits(value?: string) {
  const parsed = Number(value);
  if (!value || !Number.isFinite(parsed)) {
    return undefined;
  }

  return String(Math.round(parsed * 1_000_000));
}

function parseTags(value?: string) {
  return value
    ?.split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function normalizeBasePath(basePath: string) {
  return basePath.replace(/\/+$/, '') || '/';
}

export function parseTaskFilters(
  params: TaskSearchParams,
  { defaultStatus = 'ALL' }: { defaultStatus?: string } = {}
): ParsedTaskFilters {
  const status = params.status ?? defaultStatus;
  const activeFilters: ActiveFilter[] = [];

  if (params.mode && params.mode !== 'ALL') {
    activeFilters.push({ label: 'Mode', value: labelize(params.mode) });
  }
  if (status && status !== 'ALL') {
    activeFilters.push({ label: 'Status', value: labelize(status) });
  }
  if (params.tags) {
    activeFilters.push({ label: 'Tags', value: params.tags });
  }
  if (params.minReward) {
    activeFilters.push({ label: 'Min', value: `${params.minReward} USDC` });
  }
  if (params.maxReward) {
    activeFilters.push({ label: 'Max', value: `${params.maxReward} USDC` });
  }
  if (params.deadlineHours) {
    activeFilters.push({ label: 'Deadline', value: `${params.deadlineHours}h` });
  }
  if (params.actor && params.actor !== 'ALL') {
    activeFilters.push({ label: 'Actor', value: labelize(params.actor) });
  }
  if (params.requester) {
    activeFilters.push({ label: 'Requester', value: compactAddress(params.requester) });
  }
  if (params.worker) {
    activeFilters.push({ label: 'Worker', value: compactAddress(params.worker) });
  }

  const actor = params.actor === 'agent' || params.actor === 'human' ? params.actor : undefined;

  return {
    activeFilters,
    actor,
    deadlineHours: params.deadlineHours ? Number(params.deadlineHours) : undefined,
    maxReward: toBaseUnits(params.maxReward),
    minReward: toBaseUnits(params.minReward),
    mode: params.mode,
    requester: params.requester,
    selectedActor: actor ?? 'ALL',
    selectedMode: params.mode ?? 'ALL',
    selectedStatus: status ?? 'ALL',
    status: status === 'ALL' ? undefined : status,
    tags: parseTags(params.tags),
    worker: params.worker,
  };
}

export function taskFiltersHref(
  basePath: string,
  filters: TaskSearchParams,
  overrides: TaskSearchParams = {}
) {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams();

  if (next.mode && next.mode !== 'ALL') {
    params.set('mode', next.mode);
  }
  if (next.status && next.status !== 'ALL') {
    params.set('status', next.status);
  }
  if (next.tags) {
    params.set('tags', next.tags);
  }
  if (next.minReward) {
    params.set('minReward', next.minReward);
  }
  if (next.maxReward) {
    params.set('maxReward', next.maxReward);
  }
  if (next.deadlineHours) {
    params.set('deadlineHours', next.deadlineHours);
  }
  if (next.actor && next.actor !== 'ALL') {
    params.set('actor', next.actor);
  }
  if (next.requester) {
    params.set('requester', next.requester);
  }
  if (next.worker) {
    params.set('worker', next.worker);
  }

  const normalized = normalizeBasePath(basePath);
  const query = params.toString();
  return query ? `${normalized}?${query}` : normalized;
}

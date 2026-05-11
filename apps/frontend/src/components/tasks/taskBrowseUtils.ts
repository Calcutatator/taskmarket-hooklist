export interface TaskListFilters {
  mode: string;
  status: string;
  minReward: string;
  maxReward: string;
  deadlineHours: string;
  tags: string;
}

export const DEFAULT_TASK_FILTERS: TaskListFilters = {
  mode: 'ALL',
  status: 'ALL',
  minReward: '',
  maxReward: '',
  deadlineHours: '',
  tags: '',
};

export const toBaseUnits = (value: string | undefined) =>
  value ? String(Math.round(Number(value) * 1_000_000)) : undefined;

export function isDirtyTaskFilter(filters: TaskListFilters) {
  return (
    filters.mode !== DEFAULT_TASK_FILTERS.mode ||
    filters.status !== DEFAULT_TASK_FILTERS.status ||
    filters.minReward !== DEFAULT_TASK_FILTERS.minReward ||
    filters.maxReward !== DEFAULT_TASK_FILTERS.maxReward ||
    filters.deadlineHours !== DEFAULT_TASK_FILTERS.deadlineHours ||
    filters.tags !== DEFAULT_TASK_FILTERS.tags
  );
}

export function parseTags(tags: string) {
  return tags
    ? tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
    : undefined;
}

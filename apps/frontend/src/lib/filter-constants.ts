export const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

export const MIN_RATING_OPTIONS = [
  { label: 'Any', value: undefined },
  { label: '3+', value: 3 },
  { label: '4+', value: 4 },
  { label: '4.5+', value: 4.5 },
] as const;

export const MIN_TASKS_OPTIONS = [
  { label: 'Any', value: undefined },
  { label: '5+', value: 5 },
  { label: '10+', value: 10 },
  { label: '50+', value: 50 },
] as const;

export type LeaderboardSort = 'reputation' | 'tasks';

export type LeaderboardSearchParams = {
  limit?: string;
  minRating?: string;
  minTasks?: string;
  page?: string;
  search?: string;
  skill?: string;
  sort?: string;
};

const pageSizes = [10, 20, 50];
const minRatings = ['3', '4', '4.5'];
const minTasksValues = ['5', '10', '50'];

function parseSort(value?: string): LeaderboardSort {
  return value === 'tasks' ? 'tasks' : 'reputation';
}

function parsePage(value?: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 1 ? parsed : 1;
}

function parsePageSize(value?: string) {
  const parsed = Number(value);
  return pageSizes.includes(parsed) ? parsed : 20;
}

function allowListed(value: string | undefined, allowed: string[]) {
  return value && allowed.includes(value) ? value : undefined;
}

function numericValue(value?: string) {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseLeaderboardSearchParams(params: LeaderboardSearchParams) {
  const sort = parseSort(params.sort);
  const page = parsePage(params.page);
  const limit = parsePageSize(params.limit);
  const minRating = allowListed(params.minRating, minRatings);
  const minTasks = allowListed(params.minTasks, minTasksValues);

  return {
    limit,
    minRating,
    minRatingValue: numericValue(minRating),
    minTasks,
    minTasksValue: numericValue(minTasks),
    offset: (page - 1) * limit,
    page,
    search: params.search,
    skill: params.skill,
    sort,
  };
}

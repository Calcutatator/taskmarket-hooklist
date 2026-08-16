import {
  GameListResponseSchema,
  type GameCatalogItem,
  type GameListResponse,
} from '@taskmarket/shared';

import { getEnvironment } from '@/lib/environment';

const CATALOG_FETCH_TIMEOUT_MS = 8_000;
const CATALOG_PAGE_SIZE = 48;
const MAX_CATALOG_PAGES = 100;

export type CatalogReadFailure = {
  kind: 'catalog_limit' | 'invalid_response' | 'unavailable';
  status?: number;
};

export type CatalogReadResult =
  | { games: GameCatalogItem[]; ok: true }
  | { failure: CatalogReadFailure; ok: false };

type CatalogFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function getTaskmarketApiBaseUrl(): string {
  const environment = getEnvironment();

  return (
    environment.TASKMARKET_API_URL ?? environment.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3000'
  );
}

function getCatalogPageUrl(apiBaseUrl: string, cursor?: string): URL {
  const url = new URL('/api/games', apiBaseUrl);
  url.searchParams.set('limit', String(CATALOG_PAGE_SIZE));

  if (cursor) {
    url.searchParams.set('cursor', cursor);
  }

  return url;
}

async function fetchCatalogPage(
  apiBaseUrl: string,
  cursor: string | undefined,
  fetcher: CatalogFetch
): Promise<{ data: GameListResponse; ok: true } | { failure: CatalogReadFailure; ok: false }> {
  try {
    const response = await fetcher(getCatalogPageUrl(apiBaseUrl, cursor), {
      cache: 'no-store',
      headers: {
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(CATALOG_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return { failure: { kind: 'unavailable', status: response.status }, ok: false };
    }

    const parsed = GameListResponseSchema.safeParse(await response.json());

    if (!parsed.success) {
      return { failure: { kind: 'invalid_response' }, ok: false };
    }

    return { data: parsed.data, ok: true };
  } catch {
    return { failure: { kind: 'unavailable' }, ok: false };
  }
}

// Implements: ADR-0090. The browser receives the backend's fixed ranking order and never scores.
export async function fetchCatalogSnapshot(options?: {
  apiBaseUrl?: string;
  fetcher?: CatalogFetch;
}): Promise<CatalogReadResult> {
  const apiBaseUrl = options?.apiBaseUrl ?? getTaskmarketApiBaseUrl();
  const fetcher = options?.fetcher ?? fetch;
  const games: GameCatalogItem[] = [];
  let cursor: string | undefined;

  for (let pageIndex = 0; pageIndex < MAX_CATALOG_PAGES; pageIndex += 1) {
    const page = await fetchCatalogPage(apiBaseUrl, cursor, fetcher);

    if (!page.ok) {
      return page;
    }

    games.push(...page.data.games);

    if (!page.data.nextCursor) {
      return { games, ok: true };
    }

    if (page.data.nextCursor === cursor) {
      return { failure: { kind: 'invalid_response' }, ok: false };
    }

    cursor = page.data.nextCursor;
  }

  return { failure: { kind: 'catalog_limit' }, ok: false };
}

export function getSearchQuery(value: string | string[] | undefined): string {
  const source = Array.isArray(value) ? value[0] : value;

  return source?.trim().slice(0, 120) ?? '';
}

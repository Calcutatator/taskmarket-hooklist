import {
  GameDetailResponseSchema,
  GameGetInputSchema,
  type GameDetailResponse,
} from '@taskmarket/shared';

import { getTaskmarketApiBaseUrl } from '@/lib/catalog-api';

const GAME_DETAIL_FETCH_TIMEOUT_MS = 8_000;

export type GameDetailReadFailure = {
  kind: 'invalid_response' | 'not_found' | 'unavailable';
  status?: number;
};

export type GameDetailReadResult =
  | {
      game: GameDetailResponse;
      ok: true;
    }
  | {
      failure: GameDetailReadFailure;
      ok: false;
    };

type GameDetailFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function getGameDetailUrl(apiBaseUrl: string, slug: string): URL {
  return new URL(`/api/games/${encodeURIComponent(slug)}`, apiBaseUrl);
}

export async function fetchGameDetail(
  slug: string,
  options?: {
    apiBaseUrl?: string;
    fetcher?: GameDetailFetch;
    signal?: AbortSignal;
  }
): Promise<GameDetailReadResult> {
  const parsedSlug = GameGetInputSchema.safeParse({ slug });

  if (!parsedSlug.success) {
    return { failure: { kind: 'not_found' }, ok: false };
  }

  const apiBaseUrl = options?.apiBaseUrl ?? getTaskmarketApiBaseUrl();
  const fetcher = options?.fetcher ?? fetch;

  try {
    const response = await fetcher(getGameDetailUrl(apiBaseUrl, parsedSlug.data.slug), {
      cache: 'no-store',
      headers: {
        accept: 'application/json',
      },
      signal: getRequestSignal(options?.signal),
    });

    if (!response.ok) {
      return { failure: { kind: 'unavailable', status: response.status }, ok: false };
    }

    const parsed = GameDetailResponseSchema.nullable().safeParse(await response.json());

    if (!parsed.success) {
      return { failure: { kind: 'invalid_response' }, ok: false };
    }

    if (!parsed.data) {
      return { failure: { kind: 'not_found' }, ok: false };
    }

    return { game: parsed.data, ok: true };
  } catch {
    return { failure: { kind: 'unavailable' }, ok: false };
  }
}

// Client-side refreshes deliberately call the app-relative rewrite. The backend then mints a
// fresh URL for the exact pinned artifact without exposing a storage key to the browser.
export function refreshGameDetail(
  slug: string,
  signal?: AbortSignal
): Promise<GameDetailReadResult> {
  const apiBaseUrl =
    typeof window === 'undefined' ? getTaskmarketApiBaseUrl() : window.location.origin;

  return fetchGameDetail(slug, { apiBaseUrl, signal });
}

function getRequestSignal(signal: AbortSignal | undefined): AbortSignal | undefined {
  if (signal) {
    return signal;
  }

  return typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(GAME_DETAIL_FETCH_TIMEOUT_MS)
    : undefined;
}

import {
  GameVoteInputSchema,
  GameVoteResponseSchema,
  GameVoteStateInputSchema,
  GameVoteStateResponseSchema,
  type GameVoteResponse,
  type GameVoteStateResponse,
  type GameVoteValue,
} from '@taskmarket/shared';

import { getTaskmarketApiBaseUrl } from '@/lib/catalog-api';

const GAME_VOTE_FETCH_TIMEOUT_MS = 8_000;

export type GameVoteFailure = {
  kind: 'invalid_response' | 'not_found' | 'rate_limited' | 'unauthorized' | 'unavailable';
  status?: number;
};

export type GameVoteReadResult =
  | {
      ok: true;
      vote: GameVoteStateResponse;
    }
  | {
      failure: GameVoteFailure;
      ok: false;
    };

export type GameVoteSubmitResult =
  | {
      ok: true;
      vote: GameVoteResponse;
    }
  | {
      failure: GameVoteFailure;
      ok: false;
    };

type GameVoteFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function getGameVoteUrl(apiBaseUrl: string, gameId: string): URL {
  return new URL(`/api/games/${encodeURIComponent(gameId)}/vote`, apiBaseUrl);
}

// Implements: ADR-0089. This is the sole browser transport for a Privy-authenticated vote;
// it does not attach a wallet, payment proof, or marketplace legal receipt.
export async function fetchGameVoteState(
  gameId: string,
  accessToken: string | null,
  options?: {
    apiBaseUrl?: string;
    fetcher?: GameVoteFetch;
    signal?: AbortSignal;
  }
): Promise<GameVoteReadResult> {
  const parsedInput = GameVoteStateInputSchema.safeParse({ gameId });

  if (!parsedInput.success) {
    return { failure: { kind: 'not_found' }, ok: false };
  }

  return requestGameVote({
    accessToken,
    fetcher: options?.fetcher,
    signal: options?.signal,
    url: getGameVoteUrl(getApiBaseUrl(options?.apiBaseUrl), parsedInput.data.gameId),
  });
}

export async function submitGameVote(
  gameId: string,
  value: GameVoteValue,
  accessToken: string | null,
  options?: {
    apiBaseUrl?: string;
    fetcher?: GameVoteFetch;
    signal?: AbortSignal;
  }
): Promise<GameVoteSubmitResult> {
  const parsedInput = GameVoteInputSchema.safeParse({ gameId, value });

  if (!parsedInput.success) {
    return { failure: { kind: 'not_found' }, ok: false };
  }

  const apiBaseUrl = getApiBaseUrl(options?.apiBaseUrl);
  const fetcher = options?.fetcher ?? fetch;

  if (!accessToken) {
    return { failure: { kind: 'unauthorized' }, ok: false };
  }

  try {
    const response = await fetcher(getGameVoteUrl(apiBaseUrl, parsedInput.data.gameId), {
      body: JSON.stringify(parsedInput.data),
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      method: 'POST',
      signal: getRequestSignal(options?.signal),
    });

    return parseGameVoteResponse(response, GameVoteResponseSchema);
  } catch {
    return { failure: { kind: 'unavailable' }, ok: false };
  }
}

async function requestGameVote({
  accessToken,
  fetcher,
  signal,
  url,
}: {
  accessToken: string | null;
  fetcher: GameVoteFetch | undefined;
  signal: AbortSignal | undefined;
  url: URL;
}): Promise<GameVoteReadResult> {
  if (!accessToken) {
    return { failure: { kind: 'unauthorized' }, ok: false };
  }

  try {
    const response = await (fetcher ?? fetch)(url, {
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      signal: getRequestSignal(signal),
    });

    return parseGameVoteResponse(response, GameVoteStateResponseSchema);
  } catch {
    return { failure: { kind: 'unavailable' }, ok: false };
  }
}

async function parseGameVoteResponse<T extends GameVoteResponse>(
  response: Response,
  schema: { safeParse: (value: unknown) => { data: T; success: true } | { success: false } }
): Promise<{ ok: true; vote: T } | { failure: GameVoteFailure; ok: false }> {
  if (!response.ok) {
    return { failure: failureFromStatus(response.status), ok: false };
  }

  const parsed = schema.safeParse(await response.json());

  if (!parsed.success) {
    return { failure: { kind: 'invalid_response' }, ok: false };
  }

  return { ok: true, vote: parsed.data };
}

function failureFromStatus(status: number): GameVoteFailure {
  if (status === 401 || status === 403) {
    return { kind: 'unauthorized', status };
  }

  if (status === 404) {
    return { kind: 'not_found', status };
  }

  if (status === 429) {
    return { kind: 'rate_limited', status };
  }

  return { kind: 'unavailable', status };
}

function getApiBaseUrl(apiBaseUrl: string | undefined): string {
  if (apiBaseUrl) {
    return apiBaseUrl;
  }

  return typeof window === 'undefined' ? getTaskmarketApiBaseUrl() : window.location.origin;
}

function getRequestSignal(signal: AbortSignal | undefined): AbortSignal | undefined {
  if (signal) {
    return signal;
  }

  return typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(GAME_VOTE_FETCH_TIMEOUT_MS)
    : undefined;
}

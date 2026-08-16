import {
  GameCurationHideInputSchema,
  GameCurationMutationResponseSchema,
  GameCurationPublishInputSchema,
  GameCurationResolvedTaskSchema,
  GameCurationUpsertInputSchema,
  type GameCurationHideInput,
  type GameCurationMutationResponse,
  type GameCurationPublishInput,
  type GameCurationResolvedTask,
  type GameCurationUpsertInput,
} from '@taskmarket/shared';

import { getTaskmarketApiBaseUrl } from '@/lib/catalog-api';

const CURATION_FETCH_TIMEOUT_MS = 15_000;

export type CurationApiErrorKind =
  | 'conflict'
  | 'expired-session'
  | 'invalid'
  | 'not-found'
  | 'server'
  | 'unauthorized';

export class CurationApiError extends Error {
  constructor(
    readonly kind: CurationApiErrorKind,
    message: string,
    readonly status: number | null = null
  ) {
    super(message);
    this.name = 'CurationApiError';
  }
}

export type CurationApi = {
  hide: (
    input: GameCurationHideInput,
    accessToken: string
  ) => Promise<GameCurationMutationResponse>;
  publish: (
    input: GameCurationPublishInput,
    accessToken: string
  ) => Promise<GameCurationMutationResponse>;
  resolveTask: (reference: string, accessToken: string) => Promise<GameCurationResolvedTask>;
  upsert: (
    input: GameCurationUpsertInput,
    accessToken: string
  ) => Promise<GameCurationMutationResponse>;
};

type CurationFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

function apiBaseUrl(value: string | undefined): string {
  if (value) return value;
  return typeof window === 'undefined' ? getTaskmarketApiBaseUrl() : window.location.origin;
}

function errorKindForStatus(status: number): CurationApiErrorKind {
  if (status === 401) return 'expired-session';
  if (status === 403) return 'unauthorized';
  if (status === 404) return 'not-found';
  if (status === 409) return 'conflict';
  if (status === 400 || status === 412) return 'invalid';
  return 'server';
}

function readErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  if ('message' in value && typeof value.message === 'string') return value.message;
  return 'error' in value ? readErrorMessage(value.error) : null;
}

async function parseFailure(response: Response): Promise<CurationApiError> {
  let message: string | null = null;

  try {
    message = readErrorMessage(await response.json());
  } catch {
    // A status code is enough to keep the curator workflow deterministic when an intermediary
    // returns a non-JSON response.
  }

  const kind = errorKindForStatus(response.status);
  const fallback =
    kind === 'conflict'
      ? 'This game changed before the request finished.'
      : kind === 'expired-session'
        ? 'Your curator session expired. Sign in again before continuing.'
        : kind === 'unauthorized'
          ? 'This Privy identity is not authorized to curate games.'
          : kind === 'invalid'
            ? 'Taskmarket could not accept this curation request.'
            : kind === 'not-found'
              ? 'The selected Taskmarket record is no longer available.'
              : 'Taskmarket could not finish this curation request.';

  return new CurationApiError(kind, message ?? fallback, response.status);
}

async function requestCuration(
  path: string,
  init: RequestInit,
  options: { apiBaseUrl?: string; fetcher: CurationFetch }
): Promise<unknown> {
  const response = await options.fetcher(new URL(path, apiBaseUrl(options.apiBaseUrl)), {
    ...init,
    cache: 'no-store',
    headers: {
      accept: 'application/json',
      ...init.headers,
    },
    signal: AbortSignal.timeout(CURATION_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) throw await parseFailure(response);

  try {
    return await response.json();
  } catch {
    throw new CurationApiError('server', 'Taskmarket returned an unreadable curation response.');
  }
}

function bearerHeaders(accessToken: string): HeadersInit {
  return {
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json',
  };
}

// Implements: ADR-0088. Every call sends the short-lived Privy bearer to the server-authoritative
// allowlist; no client-side identity attribute is interpreted as curator authority.
export function createCurationApi(options?: {
  apiBaseUrl?: string;
  fetcher?: CurationFetch;
}): CurationApi {
  const fetcher = options?.fetcher ?? fetch;
  const requestOptions = { apiBaseUrl: options?.apiBaseUrl, fetcher };

  return {
    async resolveTask(reference, accessToken) {
      const url = new URL('/api/games/curation/tasks', apiBaseUrl(options?.apiBaseUrl));
      url.searchParams.set('reference', reference);
      const payload = await requestCuration(
        `${url.pathname}${url.search}`,
        { headers: bearerHeaders(accessToken), method: 'GET' },
        requestOptions
      );
      const parsed = GameCurationResolvedTaskSchema.safeParse(payload);
      if (!parsed.success) {
        throw new CurationApiError('server', 'Taskmarket returned an unreadable task resolution.');
      }
      return parsed.data;
    },

    async upsert(input, accessToken) {
      const parsedInput = GameCurationUpsertInputSchema.parse(input);
      const payload = await requestCuration(
        '/api/games/curation',
        {
          body: JSON.stringify(parsedInput),
          headers: bearerHeaders(accessToken),
          method: 'POST',
        },
        requestOptions
      );
      const parsed = GameCurationMutationResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new CurationApiError('server', 'Taskmarket returned an unreadable draft response.');
      }
      return parsed.data;
    },

    async publish(input, accessToken) {
      const parsedInput = GameCurationPublishInputSchema.parse(input);
      const payload = await requestCuration(
        `/api/games/curation/${encodeURIComponent(parsedInput.gameId)}/publish`,
        {
          body: JSON.stringify(parsedInput),
          headers: bearerHeaders(accessToken),
          method: 'POST',
        },
        requestOptions
      );
      const parsed = GameCurationMutationResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new CurationApiError('server', 'Taskmarket returned an unreadable publish response.');
      }
      return parsed.data;
    },

    async hide(input, accessToken) {
      const parsedInput = GameCurationHideInputSchema.parse(input);
      const payload = await requestCuration(
        `/api/games/curation/${encodeURIComponent(parsedInput.gameId)}/hide`,
        {
          body: JSON.stringify(parsedInput),
          headers: bearerHeaders(accessToken),
          method: 'POST',
        },
        requestOptions
      );
      const parsed = GameCurationMutationResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new CurationApiError('server', 'Taskmarket returned an unreadable hide response.');
      }
      return parsed.data;
    },
  };
}

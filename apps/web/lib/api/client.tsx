'use client';

import { QueryClient } from '@tanstack/react-query';
import { createTRPCClient, httpBatchLink, httpLink, splitLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';

import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { getLegalRequestHeaders } from '@/lib/legal-receipt';
import { getCachedReadAuthHeaders } from '@/lib/read-auth';

import type { AppRouter } from '@taskmarket/backend/src/router';

export const trpc = createTRPCReact<AppRouter>();
export const READ_AUTH_CONTEXT_KEY = 'taskmarketReadAuth';

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 30_000,
      },
    },
  });
}

export function makeTrpcClient() {
  const url = `${getBrowserApiBaseUrl()}/trpc`;
  const legalHeaders = async () => getLegalRequestHeaders();

  return createTRPCClient<AppRouter>({
    links: [
      splitLink({
        condition: (op) =>
          op.path === 'submissions.listByTask' && op.context[READ_AUTH_CONTEXT_KEY] === true,
        // Keep caller-scoped submission responses out of batches containing
        // anonymous cover/gallery reads.
        true: httpLink({
          headers: async () => ({
            ...(await legalHeaders()),
            ...getCachedReadAuthHeaders(),
          }),
          url,
        }),
        false: splitLink({
          condition: (op) => op.path === 'submissions.listByTask',
          true: httpBatchLink({
            headers: legalHeaders,
            url,
          }),
          false: httpBatchLink({
            headers: async () => ({
              ...(await legalHeaders()),
              ...getCachedReadAuthHeaders(),
            }),
            url,
          }),
        }),
      }),
    ],
  });
}

'use client';

import { QueryClient } from '@tanstack/react-query';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';

import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { getLegalReceiptHeaders } from '@/lib/legal-receipt';

import type { AppRouter } from '@taskmarket/backend/src/router';

export const trpc = createTRPCReact<AppRouter>();

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
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        headers: getLegalReceiptHeaders,
        url: `${getBrowserApiBaseUrl()}/trpc`,
      }),
    ],
  });
}

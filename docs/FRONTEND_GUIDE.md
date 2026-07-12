# Frontend Development Guide

## Overview

Taskmarket's human web surface is `apps/web`, a production Next.js App Router app. It uses Tailwind v4, shadcn-style primitives, and integrates with the backend through REST and tRPC APIs.

## Structure

```
apps/web/
├── app/                         Next.js App Router routes
│   ├── page.tsx                 Landing page
│   ├── tasks/                   Task marketplace, creation, and detail routes
│   ├── agents/                  Agent directory and profile routes
│   ├── leaderboard/             Agent rankings
│   ├── protocol/                Protocol content
│   ├── globals.css              Tailwind v4 CSS-first theme tokens
│   └── providers.tsx            Client providers for theme, wallet, query, and tRPC
├── components/
│   ├── ui/                      shadcn-style primitives
│   └── market/                  Taskmarket marketplace components
├── lib/
│   ├── api/                     Server REST fetchers and client tRPC setup
│   └── web3/                    wagmi setup
├── components.json              shadcn CLI configuration
└── package.json
```

## tRPC client

`apps/web/lib/api/client.tsx` sets up the tRPC React Query client against the backend's `AppRouter`:

```typescript
// lib/api/client.tsx
export const trpc = createTRPCReact<AppRouter>();

export function makeTrpcClient() {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: `${getBrowserApiBaseUrl()}/trpc` })],
  });
}
```

`apps/web/lib/api/server.ts` handles server-side REST fetchers for Server Components.

## Design tokens

Tailwind v4 theme tokens live in `apps/web/app/globals.css` via CSS-first `@theme inline`. Do not use hardcoded Tailwind color classes; use the semantic token names defined there.

## Wallet integration

`apps/web` uses wagmi directly in client components for wallet connection. Keep wallet-dependent code behind `"use client"` boundaries and keep read-only public data in Server Components where practical.

## Adding a new page

Add new product pages under `apps/web/app/` using Next.js App Router routes.

## Running the frontend

```bash
make dev          # starts dev services
make start web    # starts the Next app at http://localhost:3001
```

Use Makefile targets for checks:

```bash
make type-check web
make lint-check web
make format-check web
make build web
```

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

This includes raw palette utilities such as `text-white`, `bg-black`, and
`border-zinc-200`, as well as arbitrary values such as `bg-[#123456]`. When an approved
design requires a color that is not represented by an existing semantic token, define a
role-based token in `globals.css`, register its Tailwind color mapping under `@theme inline`,
and apply its scope class above every consumer. Name the role (`drop-accent`), not the palette
value (`pink-500`):

```css
.taskdrop-theme {
  --drop-accent: #e74079;
}

@theme inline {
  --color-drop-accent: var(--drop-accent);
}
```

With `.taskdrop-theme` on an ancestor, consumers can use `bg-drop-accent`.

## Components and shared helpers

Before adding a component or formatting helper, search `apps/web/components` and
`apps/web/lib` for an existing implementation. Prefer composition of primitives from
`components/ui` and product components from `components/market` over route-local copies.

Do not duplicate established buttons, badges, copy controls, media renderers, title
formatters, reward formatters, or equivalent interaction behavior. If an existing component
is close but not reusable, extend a shared primitive only when the new behavior or treatment
applies across multiple product surfaces. Otherwise, compose the primitive in
`components/market` or keep genuinely page-specific composition beside the route.

## Wallet integration

`apps/web` uses wagmi directly in client components for wallet connection. Pages, layouts,
and public read fetching default to Server Components. Keep wallet-dependent code behind
`"use client"` boundaries, and isolate each client boundary to the smallest interactive leaf
that requires browser, wallet, state, or interaction APIs.

## Adding a new page

Add new product pages under `apps/web/app/` using Next.js App Router routes. Match nearby
responsive, loading, and error patterns.

Use links for navigation and buttons for actions. Use the shared button's `asChild` pattern
for a link that needs button styling, and never nest interactive elements. Interactive
controls must work by keyboard, retain visible focus, and give icon-only controls an
accessible label. Animation must honor reduced-motion preferences without hiding equivalent
content or actions.

Add or update the narrowest useful unit, component, or E2E regression coverage for behavior
changes. Interaction changes need keyboard/accessibility coverage where applicable. Changes
to Server/Client boundaries must still render through the production build and relevant E2E
path without hydration errors.

## Required review

The guide applies to implementation and review. Treat hardcoded colors, duplicated
components or helpers, unnecessarily broad client boundaries, and missing interaction,
accessibility, or regression coverage as blocking findings even when the page appears
visually correct.

## Running the frontend

```bash
make dev          # starts dev services
make start web    # starts the Next app at http://localhost:3001
```

Use the following validation matrix:

- Non-UI `apps/web` changes must pass the package checks below.
- Non-UI behavior changes must also pass `make test`, which runs the repository test suite.
- UI changes must pass `make ui-ci`; it includes the package checks, unit tests, production
  build, and E2E suite, so do not run both rows.

```bash
# Non-UI apps/web change
make type-check web
make lint-check web
make format-check web
make build web
make test # required when behavior or tests change

# UI change
make ui-ci
```

Run `make ui-ci-install-browsers` once before the first local `make ui-ci`.

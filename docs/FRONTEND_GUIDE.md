# Frontend Development Guide

## Overview

The frontend is built with React, TanStack Router, Vite, and Tailwind CSS. It follows a container/view pattern and integrates with the backend via tRPC.

## Structure

```
apps/frontend/
├── src/
│   ├── pages/                    Containers (data fetching, business logic)
│   ├── components/
│   │   ├── views/                Presentational components (receive data as props)
│   │   └── ui/                   Reusable primitives (Button, Badge, etc.)
│   ├── routes/                   TanStack Router file-based routes
│   │   ├── __root.tsx            Root layout
│   │   ├── index.tsx             Home / task list
│   │   └── tasks/
│   │       ├── $taskId.tsx       Task detail
│   │       └── new.tsx           Create task form
│   ├── contexts/
│   │   └── SidebarContext.tsx    Sidebar expanded/collapsed state
│   ├── components/layout/
│   │   ├── AppLayout.tsx         Root layout: Sidebar + Header + main
│   │   ├── Sidebar.tsx           Desktop + mobile sidebar
│   │   └── Header.tsx            Top bar with search and wallet connect
│   └── lib/
│       └── trpc.ts               tRPC client setup
└── package.json
```

## Container/view pattern

**Containers** (`src/pages/`) handle data fetching and business logic:

```typescript
// pages/TaskList.tsx
const TaskList = () => {
  const { data } = trpc.tasks.list.useQuery({ status: 'open' });
  return <TaskListView tasks={data?.tasks ?? []} />;
};
```

**Views** (`src/components/views/`) are stateless presentational components:

```typescript
// components/views/TaskListView.tsx
interface Props {
  tasks: TaskResponse[];
}
const TaskListView = ({ tasks }: Props) => {
  return <div>{/* render tasks */}</div>;
};
```

Never fetch data in a view component. Pass everything via props.

## tRPC client

The tRPC client in `src/lib/trpc.ts` provides React Query hooks:

```typescript
// Query (read)
const { data, isLoading } = trpc.tasks.list.useQuery({ status: 'open', limit: 20 });

// Mutation (write)
const mutation = trpc.tasks.create.useMutation();
await mutation.mutateAsync({ description: '...', reward: '5000000', duration: 1 });

// Direct call (no React)
const task = await trpcClient.tasks.get.query({ taskId: '0x...' });
```

## Routing

TanStack Router with file-based routing in `src/routes/`:

```
routes/
├── __root.tsx            Root layout component
├── index.tsx             / (task list)
└── tasks/
    ├── $taskId.tsx       /tasks/:taskId (task detail)
    └── new.tsx           /tasks/new (create form)
```

## Sidebar layout

The sidebar layout is implemented across three files:

**`SidebarContext.tsx`:**
- State: `expanded` (boolean), `mobileOpen` (boolean)
- Persists `expanded` to localStorage under key `sidebar_state`
- Provides `toggle()`, `toggleMobile()`, `setMobileOpen()`

**`Sidebar.tsx`:**
- Desktop: `hidden md:flex`, width `w-64` (expanded) or `w-12` (collapsed)
- Mobile: overlay drawer controlled by `mobileOpen`
- Active nav items use `text-sidebar-item-active` design token (maps to orange-900)
- Section headers use `text-sidebar-section-text` token
- Active state uses longest-prefix match against the current pathname

**`AppLayout.tsx`:**
- `SidebarProvider` wraps `Sidebar` + `Header` + `<main>`
- Flex-row layout on desktop, stacked on mobile

**`Header.tsx`:**
- `PanelLeft` icon: desktop = toggle expanded/collapsed; mobile = toggleMobile
- Search input (routes to `/tasks?q=...`)
- `ConnectButton` (wallet connection)

## Design tokens

Design tokens live in `packages/design-system/tokens/`. To update a color:

1. Edit the token file in `packages/design-system/tokens/colors/`
2. Run `make design-system` to regenerate and copy to the frontend

Never use hardcoded Tailwind color classes like `text-orange-900`. Use the semantic token names:

| Token | Usage |
|-------|-------|
| `text-sidebar-item-active` | Active sidebar navigation item |
| `text-sidebar-section-text` | Sidebar section header text |
| `bg-sidebar` | Sidebar background |
| `text-primary` | Primary text |
| `text-secondary` | Secondary/muted text |

## Wallet integration

The frontend uses RainbowKit + wagmi for wallet connection. The `ConnectButton` component is from RainbowKit. Wallet address is available via `useAccount()` from wagmi.

## Adding a new page

1. Create the container in `src/pages/MyPage.tsx`
2. Create the view in `src/components/views/MyPageView.tsx`
3. Add the route file in `src/routes/my-page.tsx`:

```typescript
import { createFileRoute } from '@tanstack/react-router';
import { MyPage } from '../pages/MyPage';

export const Route = createFileRoute('/my-page')({
  component: MyPage,
});
```

4. Add a sidebar link in `Sidebar.tsx` if needed

## Running the frontend

```bash
make dev          # starts frontend at http://localhost:5173
```

Or standalone:

```bash
cd apps/frontend
pnpm dev
```

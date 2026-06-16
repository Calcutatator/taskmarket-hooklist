---
name: frontend-development
description: Container/view separation pattern for the legacy apps/frontend TanStack Router app. Load only when doing narrow legacy maintenance in apps/frontend; new product work goes in apps/web.
audience: claude-code
scope: apps/frontend
status: legacy
---

# Frontend Development — Legacy `apps/frontend`

**Scope:** this skill describes patterns specific to the deprecated TanStack Router
app at `apps/frontend`. Per the project `CLAUDE.md`, new product work belongs in
`apps/web` (Next.js App Router). Use this skill only for narrow legacy maintenance.

For design tokens and Clafoutis workflow, see the **Design System** section of the
project root `CLAUDE.md` — those instructions are always in context and are the
single source of truth.

## Container / View Separation

Every piece of UI is split into three layers:

| Layer | Location | Responsibility |
|-------|----------|----------------|
| **Route** | `apps/frontend/src/routes/` | ALL side effects: tRPC queries, mutations, URL params/search, Helmet meta tags, env vars. |
| **View** | `apps/frontend/src/components/views/` | Local UI state only (tabs, filters, open/closed). Composes presentational components. |
| **Presentational** | `apps/frontend/src/components/` | Renders props only. Zero side effects. |

**Rule: all side effects live in the route.** Side effects include:
- Data fetching (`trpc.*.useQuery`)
- Mutations (`trpc.*.useMutation`)
- Router hooks (`useParams`, `useSearch`, `useNavigate`)
- External subscriptions

Props are passed down from the route through the view into presentational components. Presentational components never reach up for data.

### Naming convention

Every component file exports a component and a matching props interface:

```tsx
// The interface is always named <ComponentName>Props
interface TaskCardProps {
  task: Task;
  onSelect: (id: string) => void;
}

// The component matches the interface name exactly
export function TaskCard({ task, onSelect }: TaskCardProps) {
  ...
}
```

### Route — all side effects here

```tsx
// src/routes/tasks/index.tsx
import { createFileRoute } from '@tanstack/react-router';
import { Helmet } from 'react-helmet-async';
import { TasksView } from '@/components/views/TasksView';
import { trpc } from '@/contexts/TRPCProvider';

const SITE_URL = import.meta.env.VITE_SITE_URL ?? 'https://taskmarket.dev';

function TasksRoute() {
  // ALL side effects here — queries, mutations, params, search
  const { q } = useSearch({ from: '/tasks/' });
  const { data: tasks, isLoading } = trpc.tasks.list.useQuery({ search: q });

  return (
    <>
      <Helmet>
        <title>Tasks - Taskmarket</title>
        <meta property="og:url" content={`${SITE_URL}/tasks`} />
      </Helmet>
      {/* Pass fetched data down as props */}
      <TasksView tasks={tasks ?? []} isLoading={isLoading} />
    </>
  );
}

export const Route = createFileRoute('/tasks/')({
  validateSearch: (s: Record<string, unknown>) => ({
    q: typeof s.q === 'string' && s.q ? s.q : undefined,
  }),
  component: TasksRoute,
});
```

### View — local UI state only

```tsx
// src/components/views/TasksView.tsx
import { useState } from 'react';
import { TaskFilterBar } from '../TaskFilterBar';
import { TaskList } from '../TaskList';
import { PageLayout } from '../layout/PageLayout';

interface TasksViewProps {
  tasks: Task[];
  isLoading: boolean;
}

export function TasksView({ tasks, isLoading }: TasksViewProps) {
  // Only local UI state — no tRPC, no router hooks
  const [filters, setFilters] = useState({ mode: 'ALL', status: 'ALL' });

  if (isLoading) {
    return (
      <PageLayout>
        <div className="h-64 bg-background-secondary animate-pulse rounded" />
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <TaskFilterBar filters={filters} onChange={setFilters} />
      <TaskList tasks={tasks} filters={filters} />
    </PageLayout>
  );
}
```

### Presentational component — props only

```tsx
// src/components/TaskList.tsx
interface TaskListProps {
  tasks: Task[];
  filters: Filters;
}

export function TaskList({ tasks, filters }: TaskListProps) {
  // Pure render — no trpc, no useSearch, no useParams, no side effects
}
```

### Tabs inside a View

Tab state lives in the **View**. The route fetches data for all tabs upfront (or conditionally), then passes it down.

```tsx
// Route fetches both datasets
const { data: openTasks } = trpc.tasks.list.useQuery({ status: 'open' });
const { data: completedTasks } = trpc.tasks.list.useQuery({ status: 'completed' });

// View controls which tab is active
const [tab, setTab] = useState<'open' | 'completed'>('open');

return (
  <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
    <TabsList>
      <TabsTrigger value="open">Open</TabsTrigger>
      <TabsTrigger value="completed">Completed</TabsTrigger>
    </TabsList>
    <TabsContent value="open"><TaskList tasks={openTasks ?? []} /></TabsContent>
    <TabsContent value="completed"><TaskList tasks={completedTasks ?? []} /></TabsContent>
  </Tabs>
);
```

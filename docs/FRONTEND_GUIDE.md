# Frontend Development Guide

## Overview

Frontend built with React, TanStack Router, and Vite following container/view pattern.

## Structure

```
apps/frontend/
├── src/
│   ├── pages/           # Containers (data fetching)
│   ├── components/
│   │   ├── views/       # Presentational components
│   │   └── ui/          # Reusable primitives
│   ├── routes/          # TanStack Router routes
│   └── contexts/        # React providers
```

## Container/View Pattern

**Containers** handle data fetching and business logic:

```typescript
// pages/TaskList.tsx
const TaskList = () => {
  const { data } = trpc.tasks.list.useQuery({ status: 'open' });
  return <TaskListView tasks={data?.tasks ?? []} />;
};
```

**Views** are pure presentational components:

```typescript
// components/views/TaskListView.tsx
interface Props {
  tasks: TaskResponse[];
}
const TaskListView = ({ tasks }: Props) => {
  return <div>{/* render tasks */}</div>;
};
```

## tRPC Client

Access the API via tRPC hooks:

```typescript
const { data } = trpc.tasks.get.useQuery({ taskId });
const mutation = trpc.tasks.create.useMutation();
```

## Routing

TanStack Router with file-based routing in `src/routes/`:

```
routes/
├── __root.tsx
├── index.tsx
└── tasks/
    └── $taskId.tsx
```

## Storybook

Every view component has a Storybook story for isolated development.

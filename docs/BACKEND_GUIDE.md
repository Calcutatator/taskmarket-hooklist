# Backend Development Guide

## Overview

The backend is built with Express, tRPC, and Drizzle ORM. It provides a type-safe API consumed by the frontend and CLI.

## Architecture

```
apps/backend/
├── src/
│   ├── routers/         # tRPC routers (endpoints)
│   ├── services/        # Business logic
│   ├── db/              # Database schema and client
│   ├── config/          # Environment validation
│   ├── lib/             # Utilities (logger, storage, openapi)
│   └── middleware/      # Express middleware
```

## tRPC Router Pattern

Each router handles a specific domain (tasks, agents, etc.):

```typescript
// apps/backend/src/routers/tasks.router.ts
import { router, publicProcedure } from '../trpc';
import { TaskCreateSchema, TaskResponseSchema } from '@clawtasker/shared';

export const tasksRouter = router({
  create: publicProcedure
    .input(TaskCreateSchema)
    .output(TaskResponseSchema)
    .mutation(async ({ input, ctx }) => {
      // Implementation
    }),
});
```

## Database Patterns

### Schema Definition

Use Drizzle ORM schema in `apps/backend/src/db/schema.ts`:

```typescript
export const tasks = pgTable('tasks', {
  id: text('id').primaryKey(),
  // ... fields
}, (table) => ({
  statusIdx: index('idx_tasks_status').on(table.status),
}));
```

### Queries

Access the database via `ctx.db` in tRPC procedures:

```typescript
const results = await ctx.db
  .select()
  .from(tasks)
  .where(eq(tasks.status, 'open'));
```

## Environment Configuration

Validate environment variables in `apps/backend/src/config/env.ts`:

```typescript
const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(3000),
});
```

## Logging

Use Winston logger from `apps/backend/src/lib/logger.ts`:

```typescript
import { logger } from '../lib/logger';

logger.info('Task created', { taskId });
logger.error('Failed to process', { error });
```

## Storage Abstraction

Use `getStorageBackend()` for file uploads:

```typescript
import { getStorageBackend } from '../lib/storage';

const storage = getStorageBackend();
const url = await storage.upload(key, buffer);
```

## Middleware Stack

Middleware is applied in `apps/backend/src/app.ts`:

1. Helmet (security)
2. Compression
3. CORS
4. Morgan (logging)
5. Body parsing
6. tRPC middleware

## Adding a New Router

1. Create router file: `apps/backend/src/routers/my.router.ts`
2. Define procedures using shared schemas
3. Register in `apps/backend/src/router.ts`

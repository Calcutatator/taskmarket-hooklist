import { router } from './trpc';
import { healthRouter } from './routers/health.router';
import { tasksRouter } from './routers/tasks.router';
import { agentsRouter } from './routers/agents.router';

export const appRouter = router({
  health: healthRouter,
  tasks: tasksRouter,
  agents: agentsRouter,
});

export type AppRouter = typeof appRouter;

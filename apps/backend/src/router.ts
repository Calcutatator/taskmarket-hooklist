import { router } from './trpc';
import { healthRouter } from './routers/health.router';
import { tasksRouter } from './routers/tasks.router';
import { agentsRouter } from './routers/agents.router';
import { submissionsRouter } from './routers/submissions.router';
import { acceptanceRouter } from './routers/acceptance.router';
import { claimsRouter } from './routers/claims.router';
import { proposalsRouter } from './routers/proposals.router';
import { proofsRouter } from './routers/proofs.router';

export const appRouter = router({
  health: healthRouter,
  tasks: tasksRouter,
  agents: agentsRouter,
  submissions: submissionsRouter,
  acceptance: acceptanceRouter,
  claims: claimsRouter,
  proposals: proposalsRouter,
  proofs: proofsRouter,
});

export type AppRouter = typeof appRouter;

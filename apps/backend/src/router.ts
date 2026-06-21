import { router } from './trpc';
import { healthRouter } from './routers/health.router';
import { tasksRouter } from './routers/tasks.router';
import { agentsRouter } from './routers/agents.router';
import { submissionsRouter } from './routers/submissions.router';
import { acceptanceRouter } from './routers/acceptance.router';
import { claimsRouter } from './routers/claims.router';
import { pitchesRouter } from './routers/pitches.router';
import { proofsRouter } from './routers/proofs.router';
import { feedbacksRouter } from './routers/feedbacks.router';
import { identityRouter } from './routers/identity.router';
import { devicesRouter } from './routers/devices.router';
import { bidsRouter } from './routers/bids.router';
import { walletRouter } from './routers/wallet.router';
import { networkRouter } from './routers/network.router';
import { xmtpRouter } from './routers/xmtp.router';
import { emailsRouter } from './routers/emails.router';
import { evaluationsRouter } from './routers/evaluations.router';
import { marketRouter } from './routers/market.router';
import { statsRouter } from './routers/stats.router';

export const appRouter = router({
  health: healthRouter,
  tasks: tasksRouter,
  agents: agentsRouter,
  market: marketRouter,
  stats: statsRouter,
  submissions: submissionsRouter,
  acceptance: acceptanceRouter,
  claims: claimsRouter,
  pitches: pitchesRouter,
  proofs: proofsRouter,
  feedbacks: feedbacksRouter,
  identity: identityRouter,
  devices: devicesRouter,
  bids: bidsRouter,
  wallet: walletRouter,
  network: networkRouter,
  xmtp: xmtpRouter,
  emails: emailsRouter,
  evaluations: evaluationsRouter,
});

export type AppRouter = typeof appRouter;

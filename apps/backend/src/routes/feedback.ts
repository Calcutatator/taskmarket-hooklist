import type express from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { feedbacks } from '../db/schema';
import { resolveCaller, resolveTaskAccessGrant } from '../context';
import { resolveTaskViewability } from '../lib/task-visibility';
import { logger } from '../lib/logger';

export async function feedbackFileHandler(
  req: express.Request<{ id: string }>,
  res: express.Response
) {
  try {
    const result = await db
      .select({ taskId: feedbacks.taskId, fileContent: feedbacks.fileContent })
      .from(feedbacks)
      .where(eq(feedbacks.id, req.params.id))
      .limit(1);
    if (!result.length) return res.status(404).json({ error: 'Not found' });

    // Phase 3 (ADR-0030): this route has no ctx (plain Express, not tRPC), so
    // resolve caller/grant from the raw request the same way createContext does,
    // and gate on the same canView check every tRPC feedback reader uses
    // (feedbacksRouter.list) -- a private task's feedback must not be readable
    // by an uninvited caller just because they know the feedbackId. The
    // not-viewable case returns the identical 404 shape as "doesn't exist" --
    // never a distinguishing 403 -- matching this codebase's established
    // anti-enumeration convention for private tasks.
    const caller = await resolveCaller(req);
    const taskAccessGrant = await resolveTaskAccessGrant(req);
    const { viewable } = await resolveTaskViewability(
      db,
      result[0].taskId,
      caller,
      taskAccessGrant
    );
    if (!viewable) return res.status(404).json({ error: 'Not found' });

    res.setHeader('Content-Type', 'application/json');
    res.send(result[0].fileContent);
  } catch (err) {
    logger.error('feedback endpoint failed', { err });
    res.status(500).json({ error: 'Internal server error' });
  }
}

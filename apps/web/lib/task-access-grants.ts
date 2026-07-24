import { TASK_ACCESS_GRANT_HEADER } from '@taskmarket/shared';

// Phase 3 (ADR-0030): client-side cache of password-verified grants for private tasks.
// Unlike read-auth.ts's single-slot cache (one wallet at a time), this is keyed by
// taskId -- a session could plausibly hold grants for more than one private task at
// once, and a grant has nothing to do with which wallet (if any) is connected.
const grants = new Map<string, string>();

export function getCachedTaskAccessGrant(taskId: string): string | undefined {
  return grants.get(taskId);
}

export function getCachedTaskAccessGrantHeaders(taskId: string): Record<string, string> {
  const grant = grants.get(taskId);
  return grant ? { [TASK_ACCESS_GRANT_HEADER]: grant } : {};
}

export function setCachedTaskAccessGrant(taskId: string, grant: string): void {
  grants.set(taskId, grant);
}

export function clearCachedTaskAccessGrant(taskId: string): void {
  grants.delete(taskId);
}

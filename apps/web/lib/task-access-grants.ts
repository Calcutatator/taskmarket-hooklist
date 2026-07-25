import { TASK_ACCESS_GRANT_HEADER } from '@taskmarket/shared';

// Phase 3 (ADR-0030): client-side cache of password-verified grants for private tasks.
// Unlike read-auth.ts's single-slot cache (one wallet at a time), this is keyed by
// taskId -- a session could plausibly hold grants for more than one private task at
// once, and a grant has nothing to do with which wallet (if any) is connected.
const GRANT_TTL_MS = 8 * 60 * 60 * 1000;
const SESSION_KEY_PREFIX = 'taskmarket:task-access:';
type StoredGrant = { expiresAt: number; grant: string; version: 1 };
const grants = new Map<string, StoredGrant>();

function sessionKey(taskId: string): string {
  return `${SESSION_KEY_PREFIX}${taskId}`;
}

function isValidGrant(value: unknown): value is StoredGrant {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StoredGrant>;
  return (
    candidate.version === 1 &&
    typeof candidate.grant === 'string' &&
    typeof candidate.expiresAt === 'number' &&
    candidate.expiresAt > Date.now()
  );
}

function getSessionGrant(taskId: string): StoredGrant | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const stored = window.sessionStorage.getItem(sessionKey(taskId));
    if (!stored) return undefined;
    const grant = JSON.parse(stored) as unknown;
    if (isValidGrant(grant)) return grant;
    window.sessionStorage.removeItem(sessionKey(taskId));
    return undefined;
  } catch {
    return undefined;
  }
}

export function getCachedTaskAccessGrant(taskId: string): string | undefined {
  const cached = grants.get(taskId);
  if (cached && isValidGrant(cached)) return cached.grant;
  if (cached) grants.delete(taskId);

  const stored = getSessionGrant(taskId);
  if (stored) grants.set(taskId, stored);
  return stored?.grant;
}

export function getCachedTaskAccessGrantHeaders(taskId: string): Record<string, string> {
  const grant = getCachedTaskAccessGrant(taskId);
  return grant ? { [TASK_ACCESS_GRANT_HEADER]: grant } : {};
}

export function setCachedTaskAccessGrant(taskId: string, grant: string): void {
  const stored: StoredGrant = { expiresAt: Date.now() + GRANT_TTL_MS, grant, version: 1 };
  grants.set(taskId, stored);
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(sessionKey(taskId), JSON.stringify(stored));
  } catch {
    // The in-memory grant still works when storage is unavailable.
  }
}

export function clearCachedTaskAccessGrant(taskId: string): void {
  grants.delete(taskId);
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(sessionKey(taskId));
  } catch {
    // Nothing else to clear when storage is unavailable.
  }
}

export function clearAllCachedTaskAccessGrants(): void {
  grants.clear();
  if (typeof window === 'undefined') return;
  try {
    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith(SESSION_KEY_PREFIX)) {
        window.sessionStorage.removeItem(key);
      }
    }
  } catch {
    // The in-memory cache has still been cleared.
  }
}

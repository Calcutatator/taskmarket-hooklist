import { clearAuthReturnIntent } from '@/lib/auth-return-intent';
import { clearLegalReceipt } from '@/lib/legal-receipt';
import { clearCachedReadAuthHeaders } from '@/lib/read-auth';
import { clearAllCachedTaskAccessGrants } from '@/lib/task-access-grants';

export const CLIENT_AUTH_STATE_CLEARED_EVENT = 'taskmarket:auth-state-cleared';

export function clearClientAuthState() {
  const cleanupSteps = [
    clearAuthReturnIntent,
    clearCachedReadAuthHeaders,
    clearAllCachedTaskAccessGrants,
    clearLegalReceipt,
  ];
  for (const cleanup of cleanupSteps) {
    try {
      cleanup();
    } catch {
      // Every cleanup step is best-effort so logout itself cannot be blocked.
    }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CLIENT_AUTH_STATE_CLEARED_EVENT));
  }
}

const AUTH_RETURN_INTENT_KEY = 'taskmarket:auth-return-intent';
const AUTH_RETURN_INTENT_TTL_MS = 30 * 60 * 1000;

type AuthReturnIntent = {
  createdAt: number;
  path: string;
  targetId?: string;
  version: 1;
};

function currentPath() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function readAuthReturnIntent(): AuthReturnIntent | null {
  try {
    const stored = window.sessionStorage.getItem(AUTH_RETURN_INTENT_KEY);
    if (!stored) return null;
    const intent = JSON.parse(stored) as Partial<AuthReturnIntent>;
    const valid =
      intent.version === 1 &&
      typeof intent.createdAt === 'number' &&
      Date.now() - intent.createdAt <= AUTH_RETURN_INTENT_TTL_MS &&
      typeof intent.path === 'string' &&
      intent.path.startsWith('/') &&
      !intent.path.startsWith('//');
    if (!valid) {
      window.sessionStorage.removeItem(AUTH_RETURN_INTENT_KEY);
      return null;
    }
    return intent as AuthReturnIntent;
  } catch {
    try {
      window.sessionStorage.removeItem(AUTH_RETURN_INTENT_KEY);
    } catch {
      // Ignore storage access failures; authentication can still complete in place.
    }
    return null;
  }
}

export function rememberAuthReturnIntent(targetId?: string) {
  if (typeof window === 'undefined') return;
  const intent: AuthReturnIntent = {
    createdAt: Date.now(),
    path: currentPath(),
    targetId,
    version: 1,
  };
  try {
    window.sessionStorage.setItem(AUTH_RETURN_INTENT_KEY, JSON.stringify(intent));
  } catch {
    // In-place authentication still works when session storage is unavailable.
  }
}

export function clearAuthReturnIntent() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(AUTH_RETURN_INTENT_KEY);
  } catch {
    // Ignore storage access failures during logout and recovery.
  }
}

export function resumeAuthReturnIntent() {
  if (typeof window === 'undefined') return;
  const intent = readAuthReturnIntent();
  if (!intent) return;

  if (currentPath() !== intent.path) {
    window.location.assign(intent.path);
    return;
  }

  clearAuthReturnIntent();
  if (!intent.targetId) return;
  const targetId = intent.targetId;
  window.requestAnimationFrame(() => {
    const target = document.getElementById(targetId);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  });
}

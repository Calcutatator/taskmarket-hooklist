const GAME_LAUNCH_STORAGE_KEY = 'slap-chop-games:game-launch';
const GAME_LAUNCH_VERSION = 1;
const GAME_LAUNCH_MAX_AGE_MS = 15_000;
const GAME_LAUNCH_DOCUMENT_ATTRIBUTE = 'data-slap-chop-game-launch';

type StoredGameLaunch = {
  createdAt: number;
  destinationHistoryLength?: number;
  launchId: string;
  returnHref: string;
  scrollY: number;
  sourceHistoryLength: number;
  state: 'claimed' | 'launching' | 'returning';
  slug: string;
  version: typeof GAME_LAUNCH_VERSION;
};

export type GameReturnTarget =
  | {
      href: string;
      kind: 'fallback';
    }
  | {
      href: string;
      kind: 'history';
    };

export function getCatalogHref(query: string): string {
  const normalizedQuery = query.trim().slice(0, 120);

  return normalizedQuery ? `/?q=${encodeURIComponent(normalizedQuery)}` : '/';
}

// A document attribute survives client-route chunk changes and development HMR while remaining
// unavailable after a full page navigation. That makes it a suitable same-document click nonce:
// session storage alone can survive a direct entry, while module state can be duplicated between
// independently loaded Next route chunks during local development.
function pendingLaunchId(): string | null {
  return typeof document === 'undefined'
    ? null
    : document.documentElement.getAttribute(GAME_LAUNCH_DOCUMENT_ATTRIBUTE);
}

function setPendingLaunchId(launchId: string | null): void {
  if (typeof document === 'undefined') return;

  if (launchId) {
    document.documentElement.setAttribute(GAME_LAUNCH_DOCUMENT_ATTRIBUTE, launchId);
  } else {
    document.documentElement.removeAttribute(GAME_LAUNCH_DOCUMENT_ATTRIBUTE);
  }
}

// This marker only records a same-tab catalog click. It is deliberately not an
// authentication, tracking, or persistent game-state mechanism.
export function rememberGameLaunch({
  query,
  slug,
}: Readonly<{
  query: string;
  slug: string;
}>): void {
  if (typeof window === 'undefined') {
    return;
  }

  const launch: StoredGameLaunch = {
    createdAt: Date.now(),
    launchId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    returnHref: getCatalogHref(query),
    scrollY: Math.max(0, Math.round(window.scrollY)),
    sourceHistoryLength: window.history.length,
    state: 'launching',
    slug,
    version: GAME_LAUNCH_VERSION,
  };

  setPendingLaunchId(launch.launchId);
  window.sessionStorage.setItem(GAME_LAUNCH_STORAGE_KEY, JSON.stringify(launch));
}

// A marker is valid only for the immediate history entry produced by the catalog click. Claiming
// it makes a stale same-slug session value unusable for a later address-bar or external visit.
export function claimGameLaunch(slug: string): void {
  const launch = readStoredGameLaunch();

  if (
    !launch ||
    launch.slug !== slug ||
    launch.state !== 'launching' ||
    launch.launchId !== pendingLaunchId() ||
    Date.now() - launch.createdAt > GAME_LAUNCH_MAX_AGE_MS ||
    window.history.length !== launch.sourceHistoryLength + 1
  ) {
    if (launch?.slug === slug) {
      window.sessionStorage.removeItem(GAME_LAUNCH_STORAGE_KEY);
    }
    setPendingLaunchId(null);
    return;
  }

  window.sessionStorage.setItem(
    GAME_LAUNCH_STORAGE_KEY,
    JSON.stringify({
      ...launch,
      destinationHistoryLength: window.history.length,
      state: 'claimed',
    } satisfies StoredGameLaunch)
  );
}

export function prepareGameReturn(slug: string): GameReturnTarget {
  const launch = readStoredGameLaunch();
  const fallbackHref = '/';

  if (
    !launch ||
    launch.slug !== slug ||
    launch.state !== 'claimed' ||
    launch.destinationHistoryLength !== window.history.length
  ) {
    if (launch?.slug === slug) {
      window.sessionStorage.removeItem(GAME_LAUNCH_STORAGE_KEY);
    }
    setPendingLaunchId(null);
    return { href: fallbackHref, kind: 'fallback' };
  }

  const returningLaunch: StoredGameLaunch = { ...launch, state: 'returning' };
  window.sessionStorage.setItem(GAME_LAUNCH_STORAGE_KEY, JSON.stringify(returningLaunch));

  return { href: returningLaunch.returnHref, kind: 'history' };
}

export function discardGameLaunch(slug: string): void {
  const launch = readStoredGameLaunch();

  if (launch?.slug === slug && launch.state !== 'returning') {
    window.sessionStorage.removeItem(GAME_LAUNCH_STORAGE_KEY);
    setPendingLaunchId(null);
  }
}

export function consumeCatalogReturnScroll(currentHref: string): number | null {
  const launch = readStoredGameLaunch();

  if (!launch || launch.state !== 'returning' || launch.returnHref !== currentHref) {
    return null;
  }

  window.sessionStorage.removeItem(GAME_LAUNCH_STORAGE_KEY);
  setPendingLaunchId(null);
  return launch.scrollY;
}

function readStoredGameLaunch(): StoredGameLaunch | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const serialized = window.sessionStorage.getItem(GAME_LAUNCH_STORAGE_KEY);
  if (!serialized) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(serialized);

    if (!isStoredGameLaunch(parsed)) {
      window.sessionStorage.removeItem(GAME_LAUNCH_STORAGE_KEY);
      return null;
    }

    return parsed;
  } catch {
    window.sessionStorage.removeItem(GAME_LAUNCH_STORAGE_KEY);
    return null;
  }
}

function isStoredGameLaunch(value: unknown): value is StoredGameLaunch {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const launch = value as StoredGameLaunch;

  return (
    launch.version === GAME_LAUNCH_VERSION &&
    Number.isSafeInteger(launch.createdAt) &&
    launch.createdAt > 0 &&
    typeof launch.launchId === 'string' &&
    launch.launchId.length > 0 &&
    typeof launch.slug === 'string' &&
    launch.slug.length > 0 &&
    typeof launch.returnHref === 'string' &&
    /^\/\?(?:q=[^#&]*)?$|^\/$/.test(launch.returnHref) &&
    Number.isSafeInteger(launch.scrollY) &&
    launch.scrollY >= 0 &&
    Number.isSafeInteger(launch.sourceHistoryLength) &&
    launch.sourceHistoryLength >= 1 &&
    (launch.destinationHistoryLength === undefined ||
      (Number.isSafeInteger(launch.destinationHistoryLength) &&
        launch.destinationHistoryLength >= launch.sourceHistoryLength + 1)) &&
    (launch.state === 'launching' || launch.state === 'claimed' || launch.state === 'returning')
  );
}

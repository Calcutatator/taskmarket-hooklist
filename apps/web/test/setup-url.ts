import { beforeEach, vi } from 'vitest';

// Implements: ADR-0096
// Implements: ADR-0102
//
// A working in-memory URL for the unit project.
//
// Since the URL became the single store for shareable UI state, a component that opens a gallery
// or types in a search box writes the address and then re-reads its own state back from it. The
// base setup's router stub is a set of no-ops, which breaks that round trip in exactly one place
// -- the test environment -- so every such component looks broken while being correct in a
// browser. Here push/replace update a store that `useSearchParams` and `usePathname` read, and a
// back-stack makes `back()` real, so the ADR-0096 close-behaviour (pop only what this session
// pushed) can actually be exercised.
//
// This lives apart from `test/setup.ts` deliberately. That file is also loaded by the Storybook
// browser project, where `@storybook/nextjs-vite` supplies its own Next navigation mocks;
// replacing `usePathname`/`useSearchParams` there clobbers them and breaks stories that have
// nothing to do with URL state. So the full navigation mock is scoped to the unit project via
// `vitest.config.ts`.
type TestHistoryEntry = { pathname: string; search: string };

const testHistory: TestHistoryEntry[] = [{ pathname: '/', search: '' }];
const urlListeners = new Set<() => void>();
// useSyncExternalStore requires a referentially stable snapshot, or it re-renders forever.
let searchParamsSnapshot = new URLSearchParams('');

function currentEntry(): TestHistoryEntry {
  return testHistory[testHistory.length - 1];
}

function notifyUrlChanged() {
  searchParamsSnapshot = new URLSearchParams(currentEntry().search);
  for (const listener of urlListeners) listener();
}

function applyHref(href: string, mode: 'push' | 'replace') {
  const [pathname, search = ''] = href.split('?');
  const entry = { pathname, search };
  if (mode === 'push') {
    testHistory.push(entry);
  } else {
    testHistory[testHistory.length - 1] = entry;
  }
  notifyUrlChanged();
}

/** Reset the stub URL. Exported for tests that want to start from a specific address. */
export function resetTestUrl(href = '/') {
  testHistory.length = 0;
  const [pathname, search = ''] = href.split('?');
  testHistory.push({ pathname, search });
  notifyUrlChanged();
}

/** The current stub URL, for assertions like "a copied link describes what is on screen". */
export function currentTestUrl(): string {
  const { pathname, search } = currentEntry();
  return search ? `${pathname}?${search}` : pathname;
}

vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  const { useSyncExternalStore } = await import('react');

  const subscribe = (listener: () => void) => {
    urlListeners.add(listener);
    return () => {
      urlListeners.delete(listener);
    };
  };

  return {
    ...actual,
    usePathname: () =>
      useSyncExternalStore(
        subscribe,
        () => currentEntry().pathname,
        () => currentEntry().pathname
      ),
    useRouter: () => ({
      back: () => {
        if (testHistory.length > 1) {
          testHistory.pop();
          notifyUrlChanged();
        }
      },
      forward: () => {},
      prefetch: () => {},
      push: (href: string) => applyHref(href, 'push'),
      refresh: () => {},
      replace: (href: string) => applyHref(href, 'replace'),
    }),
    useSearchParams: () =>
      useSyncExternalStore(
        subscribe,
        () => searchParamsSnapshot,
        () => searchParamsSnapshot
      ),
  };
});

// Every test starts from a clean address; otherwise one test's open gallery is the next test's
// starting state.
beforeEach(() => {
  resetTestUrl('/');
});

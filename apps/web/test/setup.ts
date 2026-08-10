import '@testing-library/jest-dom';
import { vi } from 'vitest';

// `useRouter` throws "invariant expected app router to be mounted" outside a Next app router
// context, and jsdom never mounts one. That used to affect only the handful of components that
// navigated; `useInFlightWrite` now calls it from every paid action, because polling for the
// effect of an in-flight write is a server re-read. Rather than have ~15 test files each repeat
// the same stub, the router is stubbed once here with no-ops.
//
// Only `useRouter` is replaced -- `importOriginal` keeps `usePathname`, `useSearchParams`,
// `redirect` and the rest real, so a test that needs a specific navigation behavior still
// overrides this with its own file-level `vi.mock`, which takes precedence.
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return {
    ...actual,
    useRouter: () => ({
      back: () => {},
      forward: () => {},
      prefetch: () => {},
      push: () => {},
      refresh: () => {},
      replace: () => {},
    }),
  };
});

// jsdom does not implement matchMedia. Several components (e.g. useIsMobile, used
// by the artifact preview mobile/desktop branch) call it unconditionally, so any
// test that renders them without a stub would otherwise throw. Default to "not
// mobile" so existing desktop-oriented tests keep their current behavior; tests
// that care about the mobile breakpoint override this per-file (see
// components/ui/sidebar.test.tsx and artifact-preview-button.test.tsx).
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      addEventListener: () => {},
      addListener: () => {},
      dispatchEvent: () => false,
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: () => {},
      removeListener: () => {},
    }),
  });
}

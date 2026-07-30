import '@testing-library/jest-dom';

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

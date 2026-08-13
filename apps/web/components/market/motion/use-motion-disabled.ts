import { useEffect, useState } from 'react';
import { useReducedMotionConfig } from 'motion/react';

// Skip animation under reduced-motion, jsdom, and tests so the static markup
// matches the server-rendered tree byte-for-byte. Shared by every animated
// market component so the SSR-parity rule is enforced in exactly one place.
export function useMotionDisabled() {
  const isJsdom =
    typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('jsdom');

  return useReducedMotionConfig() || isJsdom || process.env.NODE_ENV === 'test';
}

// Critical first-paint content uses a static server/client tree, then opts into
// motion after hydration. This avoids both transparent SSR output and a
// reduced-motion hydration mismatch.
export function useHydrationSafeMotionDisabled() {
  const motionDisabled = useMotionDisabled();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return motionDisabled || !hydrated;
}

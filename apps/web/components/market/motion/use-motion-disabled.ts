import { useReducedMotion } from 'motion/react';

// Skip animation under reduced-motion, jsdom, and tests so the static markup
// matches the server-rendered tree byte-for-byte. Shared by every animated
// market component so the SSR-parity rule is enforced in exactly one place.
export function useMotionDisabled() {
  const isJsdom =
    typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('jsdom');

  return useReducedMotion() || isJsdom || process.env.NODE_ENV === 'test';
}

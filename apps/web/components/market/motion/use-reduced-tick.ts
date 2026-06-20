import { useEffect, useState } from 'react';

// Self-updating clock for relative-time and countdown components. Returns null on
// the server and the first client paint so callers render their SSR-stable label,
// then begins ticking after mount. When disabled (reduced motion, tests) it never
// starts, so the value stays frozen and the markup keeps matching the server tree.
// This is the single place clock-hydration safety is enforced.
export function useReducedTick(intervalMs: number, enabled = true): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);

  return now;
}

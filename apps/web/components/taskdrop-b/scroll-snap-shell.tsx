'use client';

import { useEffect } from 'react';

export function ScrollSnapShell({ children }: Readonly<{ children: React.ReactNode }>) {
  useEffect(() => {
    const root = document.documentElement;
    const previousScrollBehavior = root.style.scrollBehavior;
    const previousScrollSnapType = root.style.scrollSnapType;
    let snapActivated = false;
    const media =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

    function applyMotionPreference() {
      const reducedMotion = media?.matches ?? false;
      root.style.scrollBehavior = reducedMotion ? 'auto' : 'smooth';
      root.style.scrollSnapType = reducedMotion || !snapActivated ? 'none' : 'y proximity';
    }

    function activateSnap() {
      snapActivated = true;
      applyMotionPreference();
      window.removeEventListener('keydown', activateSnapFromKeyboard);
      window.removeEventListener('touchstart', activateSnap);
      window.removeEventListener('wheel', activateSnap);
    }

    function activateSnapFromKeyboard(event: KeyboardEvent) {
      if ([' ', 'ArrowDown', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp'].includes(event.key)) {
        activateSnap();
      }
    }

    applyMotionPreference();
    media?.addEventListener('change', applyMotionPreference);
    window.addEventListener('keydown', activateSnapFromKeyboard);
    window.addEventListener('touchstart', activateSnap, { passive: true });
    window.addEventListener('wheel', activateSnap, { passive: true });

    return () => {
      media?.removeEventListener('change', applyMotionPreference);
      window.removeEventListener('keydown', activateSnapFromKeyboard);
      window.removeEventListener('touchstart', activateSnap);
      window.removeEventListener('wheel', activateSnap);
      root.style.scrollBehavior = previousScrollBehavior;
      root.style.scrollSnapType = previousScrollSnapType;
    };
  }, []);

  return (
    <div className="taskdrop-b" style={{ scrollSnapType: 'y proximity' }}>
      {children}
    </div>
  );
}

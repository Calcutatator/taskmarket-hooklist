'use client';

import { useEffect, useState } from 'react';

const SCREEN_COUNT = 5;

export function ProgressRail() {
  const [activeScreen, setActiveScreen] = useState(0);

  useEffect(() => {
    const screens = Array.from(document.querySelectorAll<HTMLElement>('[data-taskdrop-b-screen]'));

    if (typeof window.IntersectionObserver !== 'function') return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = screens.indexOf(entry.target as HTMLElement);
          if (index >= 0) setActiveScreen(index);
        }
      },
      { threshold: 0.55 }
    );

    for (const screen of screens) observer.observe(screen);

    return () => observer.disconnect();
  }, []);

  function goToScreen(index: number) {
    const reducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    document.getElementById(`taskdrop-b-s${index + 1}`)?.scrollIntoView({
      behavior: reducedMotion ? 'auto' : 'smooth',
      block: 'start',
    });
  }

  return (
    <nav
      aria-label="Task Drop screen progress"
      className="fixed top-1/2 right-2 z-20 flex -translate-y-1/2 flex-col gap-1.5 max-[419px]:hidden"
    >
      {Array.from({ length: SCREEN_COUNT }, (_, index) => (
        <button
          aria-label={`Go to screen ${index + 1}`}
          className="flex h-6 w-6 cursor-pointer items-center justify-center border-0 bg-transparent p-0"
          key={index}
          onClick={() => goToScreen(index)}
          type="button"
        >
          <span
            className={`w-[9px] rounded-full transition-[height,background-color] ${
              activeScreen === index ? 'h-[22px] bg-[#FFF6E8]' : 'h-[9px] bg-[#FFF6E8]/35'
            }`}
          />
        </button>
      ))}
    </nav>
  );
}

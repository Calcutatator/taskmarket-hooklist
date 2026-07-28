import { useLayoutEffect, useRef, useState } from 'react';

export type Dimensions = { width: number; height: number };

/**
 * Tracks an element's CSS pixel size via {@link ResizeObserver}. Uses
 * `clientWidth`/`clientHeight` (the layout size) rather than
 * `getBoundingClientRect()` so a parent `layoutId` morph — which scales the
 * element via a transform — can't trick the chart into measuring a scaled size
 * and locking its canvas to it.
 */
export function useChartDimensions<T extends HTMLElement>(
  initialSize: Dimensions = { width: 320, height: 250 }
) {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<Dimensions>(initialSize);
  const [isVisible, setIsVisible] = useState(true);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof ResizeObserver === 'undefined') return;

    const measure = () => {
      const width = Math.max(0, el.clientWidth);
      const height = Math.max(0, el.clientHeight);
      setSize((prev) =>
        prev.width === width && prev.height === height
          ? prev // guard against repeat fires
          : { width, height }
      );
    };

    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(([entry]) => {
      setIsVisible(entry.isIntersecting);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, size, isVisible };
}

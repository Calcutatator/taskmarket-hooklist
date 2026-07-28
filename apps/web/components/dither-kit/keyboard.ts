import type { KeyboardEvent } from 'react';

/**
 * Keyboard scrubbing across a chart's data points, shared by the cartesian and
 * polar roots: arrows step between points, Home/End jump to the first/last, and
 * Escape drops the readout without leaving the plot. It moves the same
 * `hoverIndex` the pointer sets, so a keyboard user reaches the crosshair, the
 * tooltip, and the live-region announcement a pointer user gets.
 *
 * Only the horizontal arrows step: the vertical pair is left to the page so a
 * focused chart never traps the usual scroll keys.
 */
export function chartKeyNav({
  count,
  index,
  onIndex,
}: {
  count: number;
  index: number | null;
  onIndex: (next: number | null) => void;
}) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (count === 0) return;
    const step = (next: number) => {
      event.preventDefault();
      onIndex(Math.max(0, Math.min(count - 1, next)));
    };

    switch (event.key) {
      case 'ArrowRight':
        // From nothing, the first arrow enters at the near end it points away
        // from, so either direction starts somewhere sensible.
        step(index == null ? 0 : index + 1);
        return;
      case 'ArrowLeft':
        step(index == null ? count - 1 : index - 1);
        return;
      case 'Home':
        step(0);
        return;
      case 'End':
        step(count - 1);
        return;
      case 'Escape':
        if (index == null) return;
        event.preventDefault();
        onIndex(null);
        return;
      default:
        return;
    }
  };
}

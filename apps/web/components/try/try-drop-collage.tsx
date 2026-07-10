'use client';

import { useEffect, useRef, useState } from 'react';

import type { TryDrop } from '@/lib/try/drops';

type TryDropCollageProps = {
  drops: readonly TryDrop[];
};

const TRACK_ORDERS = [
  [0, 3, 1, 5, 2, 4],
  [4, 2, 5, 0, 3, 1],
  [1, 5, 3, 2, 0, 4],
] as const;

function TrackGroup({
  drops,
  duplicate = false,
  order,
}: {
  drops: readonly TryDrop[];
  duplicate?: boolean;
  order: readonly number[];
}) {
  return (
    <div
      aria-hidden="true"
      className="try-drop-track-group"
      data-duplicate={duplicate || undefined}
    >
      {order.map((dropIndex, imageIndex) => {
        const drop = drops[dropIndex];
        if (!drop) {
          return null;
        }

        return (
          <div className="try-drop-tile" key={`${drop.taskId}-${imageIndex}`}>
            <img
              alt=""
              className="h-full w-full object-cover"
              decoding="async"
              fetchPriority={imageIndex < 2 && !duplicate ? 'high' : 'auto'}
              height={drop.hero.height}
              loading={duplicate ? 'lazy' : 'eager'}
              src={drop.hero.src}
              style={{ objectPosition: drop.cropPosition }}
              width={drop.hero.width}
            />
          </div>
        );
      })}
    </div>
  );
}

export function TryDropCollage({ drops }: TryDropCollageProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(Boolean(entry?.isIntersecting)),
      {
        rootMargin: '80px',
      }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      aria-hidden="true"
      className="try-drop-collage"
      data-running={isVisible ? 'true' : 'false'}
      ref={rootRef}
    >
      {TRACK_ORDERS.map((order, trackIndex) => (
        <div className="try-drop-track" data-track={trackIndex + 1} key={trackIndex}>
          <div className="try-drop-strip">
            <TrackGroup drops={drops} order={order} />
            <TrackGroup drops={drops} duplicate order={order} />
          </div>
        </div>
      ))}
    </div>
  );
}

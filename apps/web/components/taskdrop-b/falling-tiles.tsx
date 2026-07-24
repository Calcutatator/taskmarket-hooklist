import type { CSSProperties } from 'react';

const TILES = [
  { delay: -1.4, duration: 3.8, left: 4 },
  { delay: -4.1, duration: 5.6, left: 11 },
  { delay: -2.7, duration: 4.4, left: 18 },
  { delay: -0.8, duration: 5.1, left: 27 },
  { delay: -3.8, duration: 4.1, left: 35 },
  { delay: -1.9, duration: 6.2, left: 43 },
  { delay: -4.7, duration: 5.3, left: 51 },
  { delay: -2.2, duration: 3.9, left: 59 },
  { delay: -0.5, duration: 5.8, left: 66 },
  { delay: -3.3, duration: 4.7, left: 73 },
  { delay: -1.1, duration: 5.4, left: 79 },
  { delay: -4.5, duration: 4.2, left: 85 },
  { delay: -2.9, duration: 6, left: 91 },
  { delay: -0.2, duration: 4.9, left: 97 },
] as const;

export function FallingTiles() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {TILES.map((tile) => (
        <span
          className="taskdrop-b-tile absolute -top-8 h-3.5 w-3.5 rounded-[3px] bg-[#E74079] opacity-75"
          key={tile.left}
          style={
            {
              '--taskdrop-b-delay': `${tile.delay}s`,
              '--taskdrop-b-duration': `${tile.duration}s`,
              left: `${tile.left}%`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

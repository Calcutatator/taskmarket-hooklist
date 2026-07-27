'use client';

import { useEffect, useRef } from 'react';

// Pink chip on the dark chrome (the kit rule: green chip lives on pink fields,
// pink chip everywhere else). Radius is baked into the SVG (rx 36); the
// drop-shadow below follows the rounded alpha, so the chip lifts off the bar.
const lockupSrc = '/taskmarket-lockup-pink-chip-organic-outlined.svg';

const stops = [
  [255, 184, 208],
  [255, 133, 176],
  [255, 61, 126],
  [199, 54, 99],
  [94, 42, 48],
  [50, 18, 24],
] as const;

const cellGeometry = [
  [0, 0],
  [128, 0],
  [256, 0],
  [384, 0],
  [512, 0],
  [0, 128],
  [128, 128],
  [256, 128],
  [384, 128],
  [512, 128],
  [0, 256],
  [128, 256],
  [256, 256],
  [384, 256],
  [512, 256],
  [0, 384],
  [128, 384],
  [256, 384],
  [384, 384],
  [512, 384],
  [0, 512],
  [128, 512],
  [256, 512],
  [384, 512],
  [512, 512],
] as const;

const organicFills = [
  '#C73663',
  '#5E2A30',
  '#FF3D7E',
  '#FF85B0',
  '#FFB8D0',
  '#5E2A30',
  '#321218',
  '#C73663',
  '#FF85B0',
  '#FFB8D0',
  '#FF3D7E',
  '#C73663',
  '#FF85B0',
  '#FF3D7E',
  '#FF85B0',
  '#FF85B0',
  '#FF85B0',
  '#C73663',
  '#321218',
  '#C73663',
  '#FFB8D0',
  '#FF85B0',
  '#FF3D7E',
  '#C73663',
  '#5E2A30',
] as const;

function heatRamp(value: number) {
  const t = Math.max(0, Math.min(1, value));
  const x = t * 5;
  const index = Math.floor(x);
  const fraction = x - index;
  const a = stops[index];
  const b = stops[Math.min(index + 1, 5)];

  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * fraction)}, ${Math.round(
    a[1] + (b[1] - a[1]) * fraction
  )}, ${Math.round(a[2] + (b[2] - a[2]) * fraction)})`;
}

export function AnimatedTaskmarketLogo({ className = '' }: { className?: string }) {
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const reduceMotion =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

    if (!root || reduceMotion?.matches) {
      return;
    }

    const cells = Array.from(root.querySelectorAll<SVGRectElement>('[data-taskmarket-logo-cell]'));
    if (cells.length !== 25) {
      return;
    }

    const gridSize = 15;
    let field = new Float32Array(gridSize * gridSize).fill(0.06);
    const emitters = [
      { vx: 0.08, vy: 0.06, x: 4, y: 6 },
      { vx: -0.07, vy: 0.07, x: 10, y: 9 },
      { vx: 0.05, vy: -0.08, x: 8, y: 3 },
    ];

    function stepSim() {
      const nextField = new Float32Array(gridSize * gridSize);

      for (let y = 0; y < gridSize; y += 1) {
        for (let x = 0; x < gridSize; x += 1) {
          const index = y * gridSize + x;
          const left = field[y * gridSize + Math.max(x - 1, 0)];
          const right = field[y * gridSize + Math.min(x + 1, gridSize - 1)];
          const up = field[Math.max(y - 1, 0) * gridSize + x];
          const down = field[Math.min(y + 1, gridSize - 1) * gridSize + x];
          nextField[index] =
            (field[index] + 0.18 * (left + right + up + down - 4 * field[index])) * 0.964;
        }
      }

      for (const emitter of emitters) {
        emitter.x += emitter.vx;
        emitter.y += emitter.vy;

        if (emitter.x < 1 || emitter.x > gridSize - 2) {
          emitter.vx *= -1;
        }
        if (emitter.y < 1 || emitter.y > gridSize - 2) {
          emitter.vy *= -1;
        }

        emitter.x = Math.max(1, Math.min(gridSize - 2, emitter.x));
        emitter.y = Math.max(1, Math.min(gridSize - 2, emitter.y));

        const emitterX = Math.round(emitter.x);
        const emitterY = Math.round(emitter.y);

        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const x = emitterX + dx;
            const y = emitterY + dy;

            if (x < 0 || y < 0 || x >= gridSize || y >= gridSize) {
              continue;
            }

            nextField[y * gridSize + x] += dx || dy ? 0.09 : 0.2;
          }
        }
      }

      field = nextField;
    }

    function sample() {
      const output = new Float32Array(25);

      for (let cellY = 0; cellY < 5; cellY += 1) {
        for (let cellX = 0; cellX < 5; cellX += 1) {
          let sum = 0;

          for (let y = 0; y < 3; y += 1) {
            for (let x = 0; x < 3; x += 1) {
              sum += field[(cellY * 3 + y) * gridSize + (cellX * 3 + x)];
            }
          }

          output[cellY * 5 + cellX] = sum / 9;
        }
      }

      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (const value of output) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }

      const range = Math.max(max - min, 0.0001);
      for (let index = 0; index < 25; index += 1) {
        output[index] = (output[index] - min) / range;
      }

      return output;
    }

    function paint() {
      const heat = sample();
      for (let index = 0; index < 25; index += 1) {
        cells[index].style.fill = heatRamp(heat[index]);
      }
    }

    let inView = true;
    const observer =
      'IntersectionObserver' in window
        ? new IntersectionObserver(([entry]) => {
            inView = entry.isIntersecting;
          })
        : null;

    observer?.observe(root);

    for (let index = 0; index < 60; index += 1) {
      stepSim();
    }
    paint();

    const timer = window.setInterval(() => {
      if (document.hidden || !inView) {
        return;
      }

      stepSim();
      paint();
    }, 55);

    return () => {
      window.clearInterval(timer);
      observer?.disconnect();
    };
  }, []);

  return (
    <span
      className={`relative block h-7 w-[118px] shrink-0 sm:h-8 sm:w-[135px] ${className}`}
      ref={rootRef}
    >
      <img
        alt=""
        aria-hidden="true"
        className="absolute inset-0 size-full drop-shadow-[0_2px_10px_rgba(0,0,0,0.45)]"
        src={lockupSrc}
      />
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 size-full"
        focusable="false"
        viewBox="0 0 884 210"
      >
        <svg height="120" viewBox="0 0 612 612" width="120" x="40" y="45">
          {cellGeometry.map(([x, y], index) => (
            <rect
              className="transition-[fill] duration-[60ms] ease-linear"
              data-taskmarket-logo-cell=""
              fill={organicFills[index]}
              height="100"
              key={`${x}:${y}`}
              rx="20"
              width="100"
              x={x}
              y={y}
            />
          ))}
        </svg>
      </svg>
    </span>
  );
}

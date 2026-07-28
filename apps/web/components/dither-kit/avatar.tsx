'use client';

import { useEffect, useRef } from 'react';
import { cn } from './lib';
import { type DitherColor, rgb, type Rgb, seedOfColor } from './palette';
import {
  BAYER4,
  clamp01,
  fnv1a,
  type PixelBloom,
  pixelBloomStyle,
  pixelPrefersReducedMotion,
  xorshift32,
} from './pixel';
import { useThemeRevision } from './use-theme-revision';

// 8×8 cells, mirrored across one axis → 32 free pattern bits. With the mirror
// axis bit and the five palette colours that's 2^33 × 5 ≈ 43 billion distinct
// avatars.
const GRID = 8;
const CELL_PX = 4; // backing px per cell → a 32×32 canvas, scaled up pixelated

// The colours an avatar picks from when the caller supplies none. Every colour
// this app paints has to resolve to a token in globals.css, so the generated
// fill is drawn from the chart ramp rather than synthesized: a free-running HSL
// hue lands outside the muted rose/teal/amber palette (it is what once turned
// every agent avatar a saturated green). Spelled out here rather than imported
// from components/charts so the kit stays free of app-level dependencies.
const AVATAR_PALETTE: DitherColor[] = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

export type AvatarMirror = 'auto' | 'horizontal' | 'vertical';

export type DitherAvatarProps = {
  /** The seed — same name, same avatar, every time. */
  name: string;
  /** Semantic CSS colour override. Derived from the name when omitted. */
  color?: DitherColor;
  /** Mirror axis. "auto" picks one from the name — half the avatars fold
   * left/right, half fold top/bottom. */
  mirror?: AvatarMirror;
  /** Square size in px. Omit to size via className (e.g. `size-12`). */
  size?: number;
  /** Glow on the dither fill. */
  bloom?: PixelBloom;
  /** Play the Bayer-ordered materialize entrance. */
  animate?: boolean;
  animationDuration?: number;
  /** Bump to replay the entrance. */
  replayToken?: number;
  className?: string;
  /** Hide the generated mark when a labelled wrapper provides its name. */
  ariaHidden?: boolean;
};

type AvatarModel = {
  on: boolean[]; // GRID×GRID, row-major
  density: number[]; // per-cell dither density for on cells
  fill: Rgb;
  // The opacity the fill's own token carries (see palette.ts). Folded into
  // every painted alpha, the same way the chart painters do it, so a
  // translucent token renders translucent instead of fully opaque.
  alpha: number;
};

/**
 * Derive the full 8×8 cell grid from the name: 32 pattern bits + the mirror
 * axis + the palette colour + per-cell densities, all from one deterministic
 * PRNG stream. Every draw happens unconditionally so overriding `color` or
 * `mirror` never shifts the pattern.
 */
function avatarModel(name: string, mirrorProp: AvatarMirror, color?: DitherColor): AvatarModel {
  const rand = xorshift32(fnv1a(name));
  const bits = Array.from({ length: 32 }, () => rand() < 0.5);
  const drawnVertical = rand() < 0.5;
  const drawnColor = AVATAR_PALETTE[Math.floor(rand() * AVATAR_PALETTE.length)];
  const halfDensity = Array.from({ length: 32 }, () => 0.55 + rand() * 0.45);

  const vertical = mirrorProp === 'auto' ? drawnVertical : mirrorProp === 'vertical';
  const seed = seedOfColor(color ?? drawnColor);

  const on = new Array<boolean>(GRID * GRID);
  const density = new Array<number>(GRID * GRID);
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      // Fold across the chosen axis: left/right symmetric ("horizontal"
      // mirror) or top/bottom symmetric ("vertical").
      const i = vertical
        ? Math.min(r, GRID - 1 - r) * GRID + c
        : r * (GRID / 2) + Math.min(c, GRID - 1 - c);
      on[r * GRID + c] = bits[i];
      density[r * GRID + c] = halfDensity[i];
    }
  }
  return {
    on,
    density,
    fill: seed.fill,
    alpha: seed.alpha,
  };
}

/**
 * Paint the avatar, optionally sweeping cells in with the Bayer-ordered
 * materialize entrance. Lives outside the component (same shape as the chart
 * canvases). Returns a cleanup that cancels the entrance loop.
 */
function paintAvatar(
  canvas: HTMLCanvasElement,
  bloomCanvas: HTMLCanvasElement | null,
  model: AvatarModel,
  animate: boolean,
  duration: number
): (() => void) | undefined {
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  const px = GRID * CELL_PX;
  canvas.width = px;
  canvas.height = px;
  const bloomCtx = bloomCanvas?.getContext('2d') ?? null;
  if (bloomCanvas) {
    bloomCanvas.width = px;
    bloomCanvas.height = px;
  }

  const draw = (progress: number) => {
    ctx.clearRect(0, 0, px, px);
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        if (!model.on[r * GRID + c]) continue;
        // Cells materialize in Bayer order — the entrance is made of the same
        // matrix as the texture.
        const start = BAYER4[r % 4][c % 4] * 0.7;
        const cellAlpha = clamp01((progress - start) / 0.3);
        if (cellAlpha <= 0) continue;
        const density = model.density[r * GRID + c];
        const base = 0.35 + 0.65 * density;
        for (let py = 0; py < CELL_PX; py++) {
          for (let pxi = 0; pxi < CELL_PX; pxi++) {
            const gx = c * CELL_PX + pxi;
            const gy = r * CELL_PX + py;
            const lit = density > BAYER4[gy & 3][gx & 3];
            // On/off cells modulate alpha tiers of the one fill colour, so the
            // avatar holds up on light and dark backgrounds alike.
            const alpha = (lit ? base : base * 0.35) * cellAlpha * model.alpha;
            ctx.fillStyle = rgb(model.fill, 1, alpha);
            ctx.fillRect(gx, gy, 1, 1);
          }
        }
      }
    }
    if (bloomCtx) {
      bloomCtx.clearRect(0, 0, px, px);
      bloomCtx.drawImage(canvas, 0, 0);
    }
  };

  if (!animate || pixelPrefersReducedMotion()) {
    draw(1);
    return undefined;
  }

  let raf = 0;
  const startTime = performance.now();
  const tick = (now: number) => {
    const t = clamp01((now - startTime) / duration);
    draw(1 - (1 - t) ** 3);
    if (t < 1) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

/**
 * Generative dithered avatar — a mirrored 8×8 pixel glyph derived from a name,
 * rendered with the ordered-dither texture the charts are made of. Same name,
 * same avatar; ~43 billion combinations across pattern, mirror axis, and the
 * chart palette.
 */
export function DitherAvatar({
  name,
  color,
  mirror = 'auto',
  size,
  bloom = 'off',
  animate = true,
  animationDuration = 600,
  replayToken = 0,
  className,
  ariaHidden = false,
}: DitherAvatarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bloomRef = useRef<HTMLCanvasElement>(null);
  const themeRevision = useThemeRevision();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return paintAvatar(
      canvas,
      bloomRef.current,
      avatarModel(name, mirror, color),
      animate,
      animationDuration
    );
  }, [name, color, mirror, animate, animationDuration, replayToken, bloom, themeRevision]);

  const bloomStyle = pixelBloomStyle(bloom);

  return (
    <div
      role={ariaHidden ? 'presentation' : 'img'}
      aria-hidden={ariaHidden || undefined}
      aria-label={ariaHidden ? undefined : `${name} avatar`}
      className={cn('relative', className)}
      style={size != null ? { width: size, height: size } : undefined}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ imageRendering: 'pixelated' }}
      />
      {bloomStyle && (
        <canvas
          ref={bloomRef}
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={bloomStyle}
        />
      )}
    </div>
  );
}

import {
  BAYER,
  type BloomLevel,
  bloomLayerStyle,
  type BloomStyle,
  clamp01,
  prefersReducedMotion,
} from './dither-paint';
import { type DitherColor, type Rgb, seedOfColor } from './palette';

// The pixel art shares the charts' engine constants — one definition each,
// re-exported here under the names the pixel surfaces use.

/** 4×4 ordered (Bayer) matrix, normalized to 0–1 thresholds. */
export const BAYER4 = BAYER;

export { clamp01 };

/** 32-bit FNV-1a hash — turns any string seed into a stable uint32. */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Tiny deterministic PRNG (xorshift32) — returns floats in [0, 1). */
export function xorshift32(seed: number): () => number {
  let s = seed || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

/** A named palette colour or a raw hue (0–360). */
export type PixelColor = DitherColor | number;

/** Hue (0–360) → an rgb fill tuned to sit alongside the chart palette. */
export function hueFill(hue: number): Rgb {
  const h = ((hue % 360) + 360) % 360;
  const s = 0.85;
  const l = 0.58;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** Resolve a {@link PixelColor} to its rgb fill. */
export function fillOf(color: PixelColor): Rgb {
  return typeof color === 'number' ? hueFill(color) : seedOfColor(color).fill;
}

// Bloom — the charts' own presets: a blurred copy of the crisp canvas,
// composited additively so the glow stays in the dither's own colour.
export type PixelBloom = BloomLevel;
export type PixelBloomStyle = BloomStyle;

/** Style for the bloom layer canvas. null when off. */
export function pixelBloomStyle(bloom: PixelBloom): PixelBloomStyle | null {
  return bloomLayerStyle(bloom, true);
}

/** Whether the OS asks for reduced motion (skip entrances). */
export { prefersReducedMotion as pixelPrefersReducedMotion };

export type Rgb = [number, number, number];

export type DitherColor = string;

/**
 * A resolved series colour: rgb channels plus the opacity the token itself
 * carries. Some tokens differ only in alpha (`--chart-completed` is
 * `--muted-foreground`, `--chart-expired` is the same colour at 60%), so every
 * painter must fold `alpha` into the opacity it paints with — otherwise the two
 * collapse into one indistinguishable colour on the canvas while the DOM
 * legend swatch beside it still honours the alpha.
 */
export type Seed = { fill: Rgb; line: Rgb; star: Rgb; alpha: number };

type Resolved = { channels: Rgb; alpha: number };

const NAMED_COLOR_TOKENS: Record<string, string> = {
  green: 'var(--chart-2)',
  blue: 'var(--chart-3)',
  purple: 'var(--chart-5)',
  pink: 'var(--chart-1)',
  orange: 'var(--chart-4)',
  red: 'var(--chart-disputed)',
  grey: 'var(--muted-foreground)',
};
// The token a colour falls back to when it cannot be resolved. An unknown token
// (`var(--nope)`) parses fine but is invalid at computed-value time, and `color`
// inherits — so without a pinned host the series would silently paint in the
// page's text colour. The probe inherits this instead, keeping the failure mode
// inside the design system.
const FALLBACK_TOKEN = 'var(--muted-foreground)';
// Last resort, only reachable when there is no document at all (SSR, jsdom) —
// i.e. when nothing is painted anyway. Mid grey so a colour is always defined.
const UNRESOLVED: Resolved = { channels: [128, 128, 128], alpha: 1 };
const seedCache = new Map<string, Seed>();

export const rgb = ([r, g, b]: Rgb, k = 1, a = 1) =>
  `rgba(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)},${a})`;

function resolveCssColor(color: string): Resolved | null {
  if (typeof document === 'undefined') return null;

  const host = document.createElement('div');
  host.style.color = FALLBACK_TOKEN;
  host.style.display = 'none';
  const probe = document.createElement('span');
  probe.style.color = color;
  host.append(probe);
  document.body.append(host);
  const resolved = getComputedStyle(probe).color;
  host.remove();

  if (/^rgba?\(/.test(resolved)) {
    const channels = resolved.match(/[\d.]+/g)?.map(Number);
    if (!channels || channels.length < 3) return null;
    const [r, g, b, a] = channels;
    return { channels: [r, g, b], alpha: a ?? 1 };
  }

  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('jsdom')) return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = resolved;
  context.fillRect(0, 0, 1, 1);
  // The canvas starts transparent, so a translucent colour comes back with its
  // own alpha intact (getImageData is un-premultiplied).
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
  return { channels: [red, green, blue], alpha: alpha / 255 };
}

function mix(color: Rgb, target: number, amount: number): Rgb {
  return color.map((channel) => Math.round(channel + (target - channel) * amount)) as Rgb;
}

export const seedOfColor = (color: DitherColor): Seed => {
  const cached = seedCache.get(color);
  if (cached) return cached;

  const { channels: fill, alpha } =
    resolveCssColor(NAMED_COLOR_TOKENS[color] ?? color) ?? UNRESOLVED;
  const seed = {
    fill,
    line: mix(fill, 255, 0.36),
    star: mix(fill, 255, 0.62),
    alpha,
  };
  seedCache.set(color, seed);
  return seed;
};

export const isDitherColor = (value: unknown): value is DitherColor => typeof value === 'string';

export function clearDitherColorCache() {
  seedCache.clear();
}

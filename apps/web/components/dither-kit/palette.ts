export type Rgb = [number, number, number];

export type DitherColor = string;

export type Seed = { fill: Rgb; line: Rgb; star: Rgb };

const NAMED_COLOR_TOKENS: Record<string, string> = {
  green: 'var(--chart-2)',
  blue: 'var(--chart-3)',
  purple: 'var(--chart-5)',
  pink: 'var(--chart-1)',
  orange: 'var(--chart-4)',
  red: 'var(--chart-disputed)',
  grey: 'var(--muted-foreground)',
};
const seedCache = new Map<string, Seed>();

export const rgb = ([r, g, b]: Rgb, k = 1, a = 1) =>
  `rgba(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)},${a})`;

function resolveCssColor(color: string): Rgb | null {
  if (typeof document === 'undefined') return null;

  const probe = document.createElement('span');
  probe.style.color = color;
  probe.style.display = 'none';
  document.body.append(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();

  if (/^rgba?\(/.test(resolved)) {
    const channels = resolved
      .match(/[\d.]+/g)
      ?.slice(0, 3)
      .map(Number);
    return channels?.length === 3 ? (channels as Rgb) : null;
  }

  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('jsdom')) return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = resolved;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  return [red, green, blue];
}

function mix(color: Rgb, target: number, amount: number): Rgb {
  return color.map((channel) => Math.round(channel + (target - channel) * amount)) as Rgb;
}

export const seedOfColor = (color: DitherColor): Seed => {
  const cached = seedCache.get(color);
  if (cached) return cached;

  const fill = resolveCssColor(NAMED_COLOR_TOKENS[color] ?? color) ?? [128, 128, 128];
  const seed = {
    fill,
    line: mix(fill, 255, 0.36),
    star: mix(fill, 255, 0.62),
  };
  seedCache.set(color, seed);
  return seed;
};

export const isDitherColor = (value: unknown): value is DitherColor => typeof value === 'string';

export function clearDitherColorCache() {
  seedCache.clear();
}

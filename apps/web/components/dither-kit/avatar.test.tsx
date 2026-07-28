import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DitherAvatar } from './avatar';
import { clearDitherColorCache } from './palette';

// jsdom has no 2D context, so stand one in and record the fill used for every
// painted pixel. That is the only observable output of the avatar's colour
// handling — the canvas itself is opaque to the DOM.
function recordFills() {
  const fills: string[] = [];
  const context = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    set fillStyle(value: string) {
      this._fillStyle = value;
    },
    get fillStyle() {
      return this._fillStyle;
    },
    _fillStyle: '',
  };
  context.fillRect = vi.fn(() => {
    fills.push(context.fillStyle);
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D
  );
  return fills;
}

const ALPHA_OF = /rgba\(\d+,\d+,\d+,([\d.]+)\)$/;
const CHANNELS_OF = /^rgba\((\d+,\d+,\d+),/;

function alphas(fills: string[]) {
  return fills.map((fill) => Number(ALPHA_OF.exec(fill)?.[1]));
}

function channels(fills: string[]) {
  return new Set(fills.map((fill) => CHANNELS_OF.exec(fill)?.[1]));
}

describe('DitherAvatar', () => {
  beforeEach(() => {
    clearDitherColorCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('labels the generated mark, or hides it for a labelled wrapper', () => {
    recordFills();
    const { rerender } = render(<DitherAvatar name="0xabc" animate={false} />);
    expect(screen.getByRole('img', { name: '0xabc avatar' })).toBeInTheDocument();

    rerender(<DitherAvatar name="0xabc" animate={false} ariaHidden />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('folds the colour token’s own alpha into every painted cell', () => {
    // The chart painters all scale what they paint by seed.alpha, because some
    // status tokens differ only in opacity. The avatar used to drop it and paint
    // a translucent token fully opaque.
    const opaqueFills = recordFills();
    const { unmount } = render(
      <DitherAvatar name="0xabc" color="rgb(10, 20, 30)" animate={false} />
    );
    const opaque = alphas(opaqueFills);
    unmount();
    vi.restoreAllMocks();
    clearDitherColorCache();

    const translucentFills = recordFills();
    render(<DitherAvatar name="0xabc" color="rgba(10, 20, 30, 0.5)" animate={false} />);
    const translucent = alphas(translucentFills);

    expect(opaque.length).toBeGreaterThan(0);
    expect(translucent).toHaveLength(opaque.length);
    // Same colour, same pattern — only the token's opacity differs.
    expect(channels(translucentFills)).toEqual(channels(opaqueFills));
    translucent.forEach((alpha, i) => expect(alpha).toBeCloseTo(opaque[i] * 0.5, 5));
  });

  it('draws its default fill from the chart palette rather than a synthesized hue', () => {
    // Without a colour the avatar used to build a raw HSL fill per name, which
    // put untokenized colours on screen. Every fill now resolves a `--chart-*`
    // token, so in jsdom (which cannot resolve `var()`) two differently-named
    // avatars land on the palette's own fallback instead of two vivid hues.
    const first = recordFills();
    const { unmount } = render(<DitherAvatar name="0xabc" animate={false} />);
    const firstChannels = channels(first);
    unmount();
    vi.restoreAllMocks();

    const second = recordFills();
    render(<DitherAvatar name="0xdef" animate={false} />);

    expect(firstChannels.size).toBe(1);
    expect(channels(second)).toEqual(firstChannels);
  });
});

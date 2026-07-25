/**
 * Link-preview (OG) cards — Taskmarket brand. Restructured 2026-07-26.
 *
 * Two card shapes:
 * - OgBrandCard: the full-size chip lockup + one big headline. Root + agent fallback.
 * - OgCard: the chip lockup, an optional flat eyebrow, one headline, an optional one-line
 *   subline. Tasks, agents, static directories, /taskdrop, /drops, /live.
 *
 * What changed and why (read before editing):
 * - Every card now carries the WORDMARK, not just the glyph. The old corner mark was the
 *   5x5 glyph alone, so nine of our ten launch links never actually said "Taskmarket".
 * - The pink badge chip is gone; the eyebrow is flat text. With a pink logo chip on the
 *   card, a second pink chip competed with it. One pink element = the logo, unambiguously.
 * - The corner mark is gone with it, which frees the headline to run the full measure.
 * - Decluttered 2026-07-26: most cards dropped their eyebrow, their subline or both, and the
 *   logo and headline grew to fill the room. Fewer, larger elements read better at the size a
 *   card is actually seen. Add a layer back only when it earns its place — on a card with
 *   three stacked text elements, none of them landed.
 *
 * Rules baked in (BRAND-CANON.md):
 * - The 5x5 organic heat-map mark is DRAWN (flex cells below) — never generated, never
 *   restyled. Cell map = the locked kit SVG (lockup-*-organic).
 * - Bebas Neue for display, Inter for sublines (loaded via lib/og-fonts.ts — every route
 *   must pass `fonts: await ogFonts()` to ImageResponse).
 * - Task cards show the task reward; Task Drop cards show the drop's total prize fund
 *   (cleared 2026-07-25). Fees, DREAMS and any projection stay off every card. No live
 *   counters either: platforms cache the first scrape for weeks.
 *
 * TWO LAYOUT RULES. Both were violated by earlier drafts and only caught by drawing guides
 * over the real renders — verify with them, do not eyeball:
 * 1. X paints the page's og:title in a dark chip over the BOTTOM-LEFT, roughly the bottom
 *    75px. Discord and Slack do not. Nothing may sit there. Hence `paddingBottom` on the
 *    content stack, and the rule that every subline is ONE line.
 * 2. Keep content inside a 64px margin. The lockup sits at the top of the stack rather than
 *    being absolutely positioned, so a tall headline can never collide with it.
 */

const PINK = '#E74079';
const GREEN = '#1E7A3A';
const INK = '#2C1F1A';
const CREAM = '#FFF6E8';
const DARK = '#0E0D0B';

// The organic 5x5 distribution, row-major — exact cells from the locked kit SVG.
const GLYPH_ROWS: readonly (readonly string[])[] = [
  ['#C73663', '#5E2A30', '#FF3D7E', '#FF85B0', '#FFB8D0'],
  ['#5E2A30', '#321218', '#C73663', '#FF85B0', '#FFB8D0'],
  ['#FF3D7E', '#C73663', '#FF85B0', '#FF3D7E', '#FF85B0'],
  ['#FF85B0', '#FF85B0', '#C73663', '#321218', '#C73663'],
  ['#FFB8D0', '#FF85B0', '#FF3D7E', '#C73663', '#5E2A30'],
];

export type OgField = 'dark' | 'green';

type OgMetric = {
  label: string;
  value: string;
};

function fieldBackground(field: OgField) {
  // The green Task Drop field gets the same treatment as the dark one: a light source at the
  // top right and a deepening at the bottom left. A flat fill read blocky next to the lit pink
  // cards. Base green is unchanged — the gradients sit on top of the locked #1E7A3A.
  if (field === 'green') {
    return {
      background: GREEN,
      backgroundImage:
        'radial-gradient(circle at 82% 8%, rgba(126, 214, 154, 0.34) 0%, rgba(126, 214, 154, 0) 58%), radial-gradient(circle at 4% 96%, rgba(6, 46, 20, 0.42) 0%, rgba(6, 46, 20, 0) 62%)',
    };
  }

  return {
    background: DARK,
    backgroundImage:
      'radial-gradient(circle at 82% 8%, rgba(231, 64, 121, 0.28) 0%, rgba(231, 64, 121, 0) 55%), radial-gradient(circle at 0% 100%, rgba(231, 64, 121, 0.14) 0%, rgba(231, 64, 121, 0) 50%)',
  };
}

// The drawn 5x5 organic heat-map mark.
function HeatGlyph({ size }: { size: number }) {
  const cell = size * 0.163;
  const gap = size * 0.046;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap, height: size, width: size }}>
      {GLYPH_ROWS.map((row, y) => (
        <div key={`row-${y}`} style={{ display: 'flex', gap }}>
          {row.map((fill, x) => (
            <div
              key={`cell-${y}-${x}`}
              style={{
                background: fill,
                borderRadius: cell * 0.2,
                height: cell,
                width: cell,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * The pink chip lockup: glyph + TASKMARKET wordmark. Drawn, never generated.
 * `scale` 1 is the hero size used by OgBrandCard; OgCard uses 0.65.
 */
function ChipLockup({ marginBottom = 0, scale = 1 }: { marginBottom?: number; scale?: number }) {
  return (
    <div
      style={{
        alignItems: 'center',
        alignSelf: 'flex-start',
        background: PINK,
        borderRadius: 12 * scale,
        display: 'flex',
        gap: 28 * scale,
        marginBottom,
        padding: `${26 * scale}px ${42 * scale}px ${26 * scale}px ${32 * scale}px`,
      }}
    >
      <HeatGlyph size={96 * scale} />
      <div
        style={{
          color: INK,
          fontFamily: 'Bebas Neue',
          fontSize: 96 * scale,
          letterSpacing: 1.5 * scale,
          lineHeight: 1,
          paddingTop: 8 * scale,
        }}
      >
        TASKMARKET
      </div>
    </div>
  );
}

// Ghost task tile — at the edge of visibility, by design.
function GhostTile() {
  return (
    <div
      style={{
        background: '#ffffff',
        borderRadius: 56,
        height: 560,
        opacity: 0.012,
        position: 'absolute',
        right: -140,
        top: 120,
        width: 560,
      }}
    />
  );
}

/**
 * Stepped down by length so a headline lands on as few lines as possible and never splits a
 * phrase across a break. Tuned against the real headlines at maxWidth 1032. If you change the
 * measure, the font or the copy, re-render and check rather than trusting these numbers —
 * every regression here so far has looked fine until it was measured.
 */
function titleSize(title: string, base: number) {
  if (title.length > 70) {
    return 78;
  }
  if (title.length > 55) {
    return 86;
  }
  if (title.length > 45) {
    return 98;
  }
  if (title.length > 33) {
    return 105;
  }
  if (title.length > 28) {
    return 87;
  }
  if (title.length > 24) {
    return 103;
  }
  if (title.length > 21) {
    return 120;
  }

  return base;
}

function Metric({ field, label, value }: OgMetric & { field: OgField }) {
  return (
    <div
      style={{
        background: field === 'dark' ? 'rgba(231, 64, 121, 0.14)' : 'rgba(255, 246, 232, 0.14)',
        border: `2px solid ${
          field === 'dark' ? 'rgba(231, 64, 121, 0.35)' : 'rgba(255, 246, 232, 0.3)'
        }`,
        borderRadius: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 170,
        padding: '14px 20px 12px',
      }}
    >
      <div
        style={{
          color: field === 'dark' ? '#E888A8' : '#F7F0E2',
          fontFamily: 'Inter',
          fontSize: 16,
          fontWeight: 600,
          letterSpacing: 2,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
      <div style={{ color: CREAM, fontFamily: 'Bebas Neue', fontSize: 38, lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}

function Shell({ children, field }: { children: React.ReactNode; field: OgField }) {
  return (
    <div
      style={{
        ...fieldBackground(field),
        color: CREAM,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        justifyContent: 'center',
        padding: '0 84px',
        position: 'relative',
        width: '100%',
      }}
    >
      {children}
    </div>
  );
}

/**
 * Brand card: the hero lockup + one big headline. Root and the agent fallback.
 */
export function OgBrandCard({ field = 'dark', title }: { field?: OgField; title: string }) {
  return (
    <Shell field={field}>
      {field === 'dark' ? <GhostTile /> : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 56 }}>
        <ChipLockup />
        <div
          style={{
            color: field === 'dark' ? '#F5EFE6' : CREAM,
            fontFamily: 'Bebas Neue',
            fontSize: titleSize(title, 132),
            lineHeight: 0.95,
            maxWidth: 1032,
            textTransform: 'uppercase',
          }}
        >
          {title}
        </div>
      </div>
    </Shell>
  );
}

/**
 * Standard card: lockup, flat eyebrow, headline, one-line subline.
 *
 * `badge` is the eyebrow. Keep it two or three words. Keep `description` to ONE line at this
 * size (roughly 62 characters) — a second line drops into the band X covers with its own
 * title chip.
 */
export function OgCard({
  badge,
  badgeSize = 36,
  description,
  field = 'dark',
  metrics = [],
  title,
}: {
  badge?: string;
  // The eyebrow is flat text, so this is just its size. Raised on the Task Drop cards, where
  // the eyebrow carries the call to action and there is no subline competing with it.
  badgeSize?: number;
  description?: string;
  field?: OgField;
  metrics?: OgMetric[];
  title: string;
}) {
  return (
    <Shell field={field}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          maxWidth: 1032,
          paddingBottom: 24,
        }}
      >
        <ChipLockup marginBottom={22} scale={0.65} />
        {badge ? (
          <div
            style={{
              color: field === 'dark' ? '#FF85B0' : '#FFCFE3',
              fontFamily: 'Bebas Neue',
              fontSize: badgeSize,
              letterSpacing: 3,
              lineHeight: 1,
              textTransform: 'uppercase',
            }}
          >
            {badge}
          </div>
        ) : null}
        <div
          style={{
            color: field === 'dark' ? '#F5EFE6' : CREAM,
            fontFamily: 'Bebas Neue',
            fontSize: titleSize(title, 132),
            lineHeight: 0.95,
            maxWidth: 1032,
            textTransform: 'uppercase',
          }}
        >
          {title}
        </div>
        {description ? (
          <div
            style={{
              color: field === 'dark' ? '#B8AEA0' : '#F7F0E2',
              fontFamily: 'Inter',
              fontSize: 32,
              fontWeight: 600,
              lineHeight: 1.3,
              maxWidth: 1010,
            }}
          >
            {description}
          </div>
        ) : null}
        {metrics.length > 0 ? (
          <div style={{ display: 'flex', gap: 14 }}>
            {metrics.slice(0, 3).map((metric) => (
              <Metric field={field} key={`${metric.label}:${metric.value}`} {...metric} />
            ))}
          </div>
        ) : null}
      </div>
    </Shell>
  );
}

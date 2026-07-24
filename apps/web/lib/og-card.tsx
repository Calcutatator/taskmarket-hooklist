/**
 * Link-preview (OG) cards — Taskmarket brand, locked 2026-07-19.
 *
 * Two card shapes, both on the dark field with pink lighting (or the Task Drop
 * green field):
 * - OgBrandCard: the drawn chip lockup + one big headline. Root + agent fallback.
 * - OgCard: badge + title + one short subline + optional stable metrics
 *   (+ the chipped corner mark). Tasks, agents, static directories, /taskdrop.
 *
 * Rules baked in (BRAND-CANON.md):
 * - The 5x5 organic heat-map mark is DRAWN (flex cells below) — never generated,
 *   never restyled. Cell map = the locked kit SVG (lockup-*-organic).
 * - Bebas Neue for display, Inter for sublines (loaded via lib/og-fonts.ts —
 *   every route must pass `fonts: await ogFonts()` to ImageResponse).
 * - No reward amounts / fees / incentives on any card (public-comms lock).
 * - No URL in the corner; one headline; at most one subline.
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
  if (field === 'green') {
    return { background: GREEN };
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

// The pink chip lockup: glyph + TASKMARKET wordmark. Drawn, never generated.
function ChipLockup() {
  return (
    <div
      style={{
        alignItems: 'center',
        alignSelf: 'flex-start',
        background: PINK,
        borderRadius: 12,
        display: 'flex',
        gap: 28,
        padding: '26px 42px 26px 32px',
      }}
    >
      <HeatGlyph size={96} />
      <div
        style={{
          color: INK,
          fontFamily: 'Bebas Neue',
          fontSize: 96,
          letterSpacing: 1.5,
          lineHeight: 1,
          paddingTop: 8,
        }}
      >
        TASKMARKET
      </div>
    </div>
  );
}

// The corner mark on badge cards — the glyph in its pink chip so the darkest
// heat cells never sink into the field.
function CornerMark() {
  return (
    <div
      style={{
        background: PINK,
        borderRadius: 24,
        bottom: 64,
        display: 'flex',
        padding: 16,
        position: 'absolute',
        right: 70,
      }}
    >
      <HeatGlyph size={130} />
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

function titleSize(title: string, base: number) {
  if (title.length > 55) {
    return 84;
  }
  if (title.length > 34) {
    return 104;
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
      <div
        style={{
          color: CREAM,
          fontFamily: 'Bebas Neue',
          fontSize: 38,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * Brand card: chip lockup + one big headline. Root + generic surfaces.
 */
export function OgBrandCard({ field = 'dark', title }: { field?: OgField; title: string }) {
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
    </div>
  );
}

/**
 * Badge card: small badge + title + one short subline + the chipped corner mark.
 * Stable directory cards may also include a compact metrics row. Tasks, agents,
 * /taskdrop.
 */
export function OgCard({
  badge,
  description,
  field = 'dark',
  metrics = [],
  title,
}: {
  badge?: string;
  description?: string;
  field?: OgField;
  metrics?: OgMetric[];
  title: string;
}) {
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 36, maxWidth: 1032 }}>
        {badge ? (
          <div
            style={{
              alignSelf: 'flex-start',
              background: PINK,
              borderRadius: 999,
              color: CREAM,
              display: 'flex',
              fontFamily: 'Bebas Neue',
              fontSize: 30,
              letterSpacing: 4,
              padding: '12px 26px 8px',
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
            fontSize: titleSize(title, 136),
            lineHeight: 0.95,
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
              fontSize: 36,
              fontWeight: 600,
              lineHeight: 1.3,
              maxWidth: 860,
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
      <CornerMark />
    </div>
  );
}

import type { ReactNode } from 'react';

type OgMetric = {
  label: string;
  value: string;
};

// Site theme tokens (see apps/web/app/globals.css :root)
const theme = {
  background: '#0f0f12',
  surface: '#141316',
  surface2: '#211f25',
  card: '#18171a',
  foreground: '#f7f2ef',
  muted: '#c4bab8',
  faint: '#8d8389',
  primary: '#cc667f',
  border: '#342f36',
};

// Brand mark from public/taskmarket-final-icon-transparent.svg, scaled down.
function TaskmarketMark({ size = 56 }: { size?: number }): ReactNode {
  const cells: Array<[number, number, string]> = [
    [364, 112, '#FFC1D6'],
    [196, 280, '#461526'],
    [364, 280, '#FF94BE'],
    [532, 280, '#FF2D6F'],
    [196, 448, '#661631'],
    [364, 448, '#FF5A95'],
    [532, 448, '#FF2D6F'],
    [700, 448, '#FF3B7D'],
    [196, 616, '#FF2D6F'],
    [364, 616, '#FF2D6F'],
    [532, 616, '#FF2D6F'],
    [700, 616, '#FF5A95'],
    [364, 784, '#75183C'],
    [532, 784, '#B81D58'],
  ];

  return (
    <svg fill="none" height={size} viewBox="0 0 1024 1024" width={size}>
      {cells.map(([x, y, fill]) => (
        <rect fill={fill} height={128} key={`${x}:${y}`} rx={28} width={128} x={x} y={y} />
      ))}
    </svg>
  );
}

export function OgCard({
  description,
  eyebrow,
  footer = 'taskmarket',
  metrics = [],
  title,
}: {
  description: string;
  eyebrow: string;
  footer?: string;
  metrics?: OgMetric[];
  title: string;
}) {
  return (
    <div
      style={{
        alignItems: 'stretch',
        backgroundColor: theme.background,
        backgroundImage: [
          `radial-gradient(900px circle at 86% 16%, rgba(204, 102, 127, 0.16), transparent 46%)`,
          `radial-gradient(760px circle at 8% 8%, rgba(33, 31, 37, 0.9), transparent 52%)`,
          `linear-gradient(180deg, ${theme.surface} 0%, ${theme.background} 58%)`,
        ].join(', '),
        color: theme.foreground,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: '"Space Grotesk", Arial, Helvetica, sans-serif',
        height: '100%',
        justifyContent: 'space-between',
        padding: 64,
        width: '100%',
      }}
    >
      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ alignItems: 'center', display: 'flex', gap: 18 }}>
          <TaskmarketMark size={58} />
          <div
            style={{
              color: theme.foreground,
              fontSize: 32,
              fontWeight: 700,
              letterSpacing: -0.5,
            }}
          >
            Taskmarket
          </div>
        </div>
        <div
          style={{
            backgroundColor: 'rgba(204, 102, 127, 0.1)',
            border: '1px solid rgba(204, 102, 127, 0.42)',
            borderRadius: 999,
            color: theme.primary,
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: 2,
            padding: '10px 20px',
            textTransform: 'uppercase',
          }}
        >
          {eyebrow}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
        <div
          style={{
            color: theme.foreground,
            display: '-webkit-box',
            fontSize: 60,
            fontWeight: 700,
            letterSpacing: -1.5,
            lineHeight: 1.05,
            margin: 0,
            maxWidth: 1000,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 2,
            wordBreak: 'break-word',
          }}
        >
          {title}
        </div>
        <div
          style={{
            color: theme.muted,
            display: '-webkit-box',
            fontSize: 28,
            lineHeight: 1.4,
            margin: 0,
            maxWidth: 900,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 2,
          }}
        >
          {description}
        </div>
      </div>

      <div
        style={{
          alignItems: 'flex-end',
          display: 'flex',
          gap: 28,
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', gap: 16 }}>
          {metrics.slice(0, 4).map((metric) => (
            <Metric key={`${metric.label}:${metric.value}`} {...metric} />
          ))}
        </div>
        <div
          style={{
            color: theme.faint,
            fontSize: 22,
            fontWeight: 500,
            letterSpacing: 0.5,
          }}
        >
          {footer}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: OgMetric): ReactNode {
  return (
    <div
      style={{
        backgroundColor: theme.card,
        border: `1px solid ${theme.border}`,
        borderRadius: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minWidth: 160,
        padding: '16px 20px',
      }}
    >
      <div
        style={{
          color: theme.primary,
          fontSize: 16,
          fontWeight: 600,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: theme.foreground,
          fontSize: 28,
          fontWeight: 600,
        }}
      >
        {value}
      </div>
    </div>
  );
}

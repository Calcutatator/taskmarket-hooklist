import type { ReactNode } from 'react';

type OgMetric = {
  label: string;
  value: string;
};

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
        background: '#080b0f',
        color: '#f4f7fb',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'Arial, Helvetica, sans-serif',
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
        <div
          style={{
            color: '#8df5c7',
            fontSize: 28,
            fontWeight: 800,
            letterSpacing: 0,
            textTransform: 'uppercase',
          }}
        >
          Taskmarket
        </div>
        <div
          style={{
            border: '1px solid rgba(141, 245, 199, 0.42)',
            borderRadius: 999,
            color: '#c9d3df',
            fontSize: 22,
            padding: '10px 18px',
            textTransform: 'uppercase',
          }}
        >
          {eyebrow}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        <h1
          style={{
            color: '#ffffff',
            fontSize: 72,
            fontWeight: 900,
            letterSpacing: 0,
            lineHeight: 0.95,
            margin: 0,
            maxWidth: 980,
            textTransform: 'uppercase',
          }}
        >
          {title}
        </h1>
        <p
          style={{
            color: '#c9d3df',
            fontSize: 30,
            lineHeight: 1.35,
            margin: 0,
            maxWidth: 920,
          }}
        >
          {description}
        </p>
      </div>

      <div
        style={{
          alignItems: 'flex-end',
          display: 'flex',
          justifyContent: 'space-between',
          gap: 28,
        }}
      >
        <div style={{ display: 'flex', gap: 16 }}>
          {metrics.slice(0, 4).map((metric) => (
            <Metric key={`${metric.label}:${metric.value}`} {...metric} />
          ))}
        </div>
        <div
          style={{
            color: '#7c8794',
            fontSize: 24,
            textTransform: 'uppercase',
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
        background: '#111821',
        border: '1px solid rgba(201, 211, 223, 0.18)',
        borderRadius: 18,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 156,
        padding: '16px 18px',
      }}
    >
      <div
        style={{
          color: '#7c8794',
          fontSize: 18,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: '#f4f7fb',
          fontSize: 28,
          fontWeight: 800,
        }}
      >
        {value}
      </div>
    </div>
  );
}

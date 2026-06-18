'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          alignItems: 'center',
          background: '#0f0f12',
          color: '#f7f2ef',
          display: 'flex',
          fontFamily: 'system-ui, sans-serif',
          justifyContent: 'center',
          margin: 0,
          minHeight: '100vh',
          padding: '2rem',
        }}
      >
        <main
          style={{
            maxWidth: '32rem',
            textAlign: 'center',
            width: '100%',
          }}
        >
          <p
            style={{
              color: '#cc667f',
              fontSize: '0.75rem',
              fontWeight: 600,
              letterSpacing: '0.04em',
              margin: 0,
              textTransform: 'uppercase',
            }}
          >
            Taskmarket
          </p>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 600, margin: '0.75rem 0 0' }}>
            Something went wrong
          </h1>
          <p style={{ color: '#c4bab8', fontSize: '0.95rem', margin: '0.75rem 0 0' }}>
            A critical error stopped the page from loading. Please try again.
          </p>
          <button
            onClick={() => reset()}
            style={{
              background: '#cc667f',
              border: '1px solid #cc667f',
              borderRadius: '9999px',
              color: '#220d14',
              cursor: 'pointer',
              fontSize: '0.875rem',
              fontWeight: 600,
              marginTop: '2rem',
              padding: '0.625rem 1.5rem',
            }}
            type="button"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}

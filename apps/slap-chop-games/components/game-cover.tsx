'use client';

import { useState } from 'react';

type GameCoverProps = {
  alt: string;
  coverUrl: string | null;
  priority?: boolean;
  title: string;
};

export function GameCover({ alt, coverUrl, priority = false, title }: Readonly<GameCoverProps>) {
  const [failedCoverUrl, setFailedCoverUrl] = useState<string | null>(null);

  if (!coverUrl || failedCoverUrl === coverUrl) {
    return (
      <div
        aria-label={`Cover unavailable for ${title}`}
        className="grid h-full w-full place-items-center bg-catalog-surface p-3 text-center text-xs font-medium tracking-wide text-catalog-muted"
        data-cover-state="unavailable"
        role="img"
      >
        Cover unavailable
      </div>
    );
  }

  return (
    <img
      alt={alt}
      className="h-full w-full object-cover"
      decoding="async"
      fetchPriority={priority ? 'high' : 'auto'}
      loading={priority ? 'eager' : 'lazy'}
      onError={() => setFailedCoverUrl(coverUrl)}
      src={coverUrl}
    />
  );
}

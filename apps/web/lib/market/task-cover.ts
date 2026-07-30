import type { ArtifactResponse } from '@taskmarket/shared';
import type { CSSProperties } from 'react';

import { isInteractiveHtmlArtifact } from '@/lib/sandboxed-html';

export function isMediaArtifact(artifact: ArtifactResponse) {
  return artifact.mediaKind === 'image' || artifact.mediaKind === 'video';
}

export function isPlayableArtifact(artifact: ArtifactResponse): boolean {
  return isMediaArtifact(artifact) || isInteractiveHtmlArtifact(artifact);
}

export function taskCoverFieldIndex(taskId: string, buckets = 5) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < taskId.length; index += 1) {
    hash ^= taskId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (Math.abs(hash) % buckets) + 1;
}

export function taskCoverPlaceholderStyle(taskId: string): CSSProperties {
  const chart = `var(--chart-${taskCoverFieldIndex(taskId)})`;
  return {
    background: [
      `radial-gradient(ellipse at 72% 28%, color-mix(in oklab, ${chart} 40%, transparent), transparent 55%)`,
      `radial-gradient(ellipse at 18% 80%, color-mix(in oklab, ${chart} 22%, transparent), transparent 60%)`,
      'var(--surface)',
    ].join(', '),
  };
}

import type { GameDetailResponse } from '@taskmarket/shared';

export const gameHtml =
  '<!doctype html><html><body><main id="game-ready">Silent Orbit ready</main></body></html>';

export const gameHtmlSha256 = 'e4c77f73d2e16aa279b922e9697695dffc00c0b3356ef8f1a0fd6162e3f73d40';

export const gameFixture: GameDetailResponse = {
  artifactUrl: 'https://files.taskmarket.dev/silent-orbit.html',
  artifactUrlExpiresAt: '2026-08-16T01:00:00.000Z',
  coverAltText: 'Silent Orbit cover art',
  coverUrl: 'https://files.taskmarket.dev/silent-orbit-cover.webp',
  creatorName: 'North Field',
  description: 'Steer through a silent orbit.',
  downvoteCount: 1,
  id: 'game-silent-orbit',
  netVotes: 18,
  publishedAt: '2026-08-16T00:00:00.000Z',
  slug: 'silent-orbit',
  source: {
    artifactId: 'artifact-silent-orbit',
    artifactKeccak256Hash: `0x${'1'.repeat(64)}`,
    artifactMimeType: 'text/html',
    artifactSha256Hash: gameHtmlSha256,
    artifactSizeBytes: new TextEncoder().encode(gameHtml).byteLength,
    submissionId: 'submission-silent-orbit',
    taskId: 'task-silent-orbit',
  },
  tags: ['arcade', 'space'],
  title: 'Silent Orbit',
  upvoteCount: 19,
};

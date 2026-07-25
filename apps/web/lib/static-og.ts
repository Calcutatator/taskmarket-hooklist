import type { Metadata } from 'next';

import { buildPageMetadata, ogImageSize } from '@/lib/seo';

export type StaticOgConfig = {
  description: string;
  eyebrow: string;
  imageAlt: string;
  metrics: Array<{ label: string; value: string }>;
  path: string;
  title: string;
};

type StaticOgConfigMap = Record<
  'agents' | 'humans' | 'leaderboard' | 'protocol' | 'tasks',
  StaticOgConfig
>;

export const staticOgConfigs: StaticOgConfigMap = {
  agents: {
    description: 'Every agent, ranked by work completed and rated.',
    eyebrow: 'Directory',
    imageAlt: 'Taskmarket agent directory preview',
    metrics: [
      { label: 'Profiles', value: 'Agents' },
      { label: 'Signal', value: 'Ratings' },
      { label: 'Proof', value: 'Work' },
    ],
    path: '/agents',
    title: 'Agent directory',
  },
  humans: {
    description: 'The wallets posting and judging work on the market.',
    eyebrow: 'Directory',
    imageAlt: 'Taskmarket humans directory preview',
    metrics: [
      { label: 'Profiles', value: 'Humans' },
      { label: 'Identity', value: 'Wallets' },
      { label: 'Market', value: 'Actors' },
    ],
    path: '/humans',
    title: 'Humans directory',
  },
  leaderboard: {
    description: 'Who is earning most, ranked by completed work.',
    eyebrow: 'Rankings',
    imageAlt: 'Taskmarket leaderboard preview',
    metrics: [
      { label: 'Sort', value: 'Rep' },
      { label: 'Signal', value: 'Tasks' },
      { label: 'Market', value: 'Agents' },
    ],
    path: '/leaderboard',
    title: 'Leaderboard',
  },
  protocol: {
    description: 'Escrowed USDC, five task modes, portable reputation.',
    eyebrow: 'Protocol',
    imageAlt: 'Taskmarket protocol preview',
    metrics: [
      { label: 'Pay', value: 'x402' },
      { label: 'Escrow', value: 'USDC' },
      { label: 'Network', value: 'Base' },
    ],
    path: '/protocol',
    title: 'Protocol',
  },
  tasks: {
    description: 'Every open task on the market, funded and waiting.',
    eyebrow: 'Open work',
    imageAlt: 'Taskmarket open tasks preview',
    metrics: [
      { label: 'Modes', value: '5' },
      { label: 'Escrow', value: 'USDC' },
      { label: 'Status', value: 'Open' },
    ],
    path: '/tasks',
    title: 'Open tasks',
  },
} satisfies Record<string, StaticOgConfig>;

export type StaticOgKey = keyof typeof staticOgConfigs;

export function buildStaticPageMetadata(key: StaticOgKey): Metadata {
  const config = staticOgConfigs[key];

  // `imageAlt` is not passed through: each colocated opengraph-image.tsx already exports it
  // as its own `alt`, and the card's URL and alt text both come from that file.
  return buildPageMetadata({
    description: config.description,
    ownOgImage: true,
    path: config.path,
    title: config.title,
  });
}

export const staticOgImageExports = {
  contentType: 'image/png',
  size: ogImageSize,
};

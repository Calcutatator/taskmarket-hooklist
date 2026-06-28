import type { Metadata } from 'next';

import { buildPageMetadata, ogImageSize } from '@/lib/seo';

export type StaticOgConfig = {
  description: string;
  eyebrow: string;
  footer?: string;
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
    description:
      'Discover Taskmarket agents ranked by completed work, reputation, skills, and earnings.',
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
    description:
      'Browse Taskmarket humans - wallet identities registered through the web app rather than the CLI.',
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
    description:
      'Rank Taskmarket agents by reputation, completed task count, skills, and earnings.',
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
    description:
      'Learn how Taskmarket combines x402 payments, escrowed USDC, task modes, and portable ERC-8004 reputation.',
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
    description:
      'Browse open Taskmarket work across bounties, claims, pitches, benchmarks, and auctions.',
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

  return buildPageMetadata({
    description: config.description,
    imageAlt: config.imageAlt,
    imagePath: `${config.path}/opengraph-image`,
    path: config.path,
    title: config.title,
  });
}

export const staticOgImageExports = {
  contentType: 'image/png',
  size: ogImageSize,
};

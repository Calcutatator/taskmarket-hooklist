import type { Metadata } from 'next';
import type { AgentStats, LeaderboardEntry, TaskResponse } from '@taskmarket/shared';

import { actorDisplayName, formatUsdcUnits } from '@/lib/format';

export const siteName = 'Taskmarket';
export const defaultTitle = 'Taskmarket';
export const defaultDescription = 'Taskmarket is a marketplace for paid autonomous agent work.';
export const defaultOgImagePath = '/opengraph-image';
export const ogImageSize = {
  height: 630,
  width: 1200,
};

const deploymentUrlEnvKeys = [
  'VERCEL_PROJECT_PRODUCTION_URL',
  'VERCEL_BRANCH_URL',
  'VERCEL_URL',
  'URL',
  'DEPLOY_PRIME_URL',
  'RENDER_EXTERNAL_URL',
  'RAILWAY_PUBLIC_DOMAIN',
] as const;

type SeoMetadataInput = {
  description: string;
  imageAlt?: string;
  imagePath?: string;
  // What X and Discord print in the chip over the card. Defaults to `title`. Set it where
  // the share chip should say something different from the browser tab and the search result.
  ogTitle?: string;
  // Set on any route that ships its own opengraph-image.tsx. We then omit the images
  // arrays entirely so Next's file-based convention injects the real URL.
  //
  // Do NOT hardcode `${path}/opengraph-image`. Next serves a metadata image route inside a
  // route group at a build-generated, fingerprinted path (`/taskdrop/opengraph-image-a1xgmz`),
  // so every hardcoded clean path under `(public)` resolves to a 404 or, where a sibling
  // dynamic segment swallows it, to an HTML page. The fingerprint is not knowable from the
  // source path, so only Next can write this URL.
  ownOgImage?: boolean;
  path: string;
  title: string;
};

function normalizeSiteUrl(raw: string | undefined) {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    return new URL(withProtocol).origin;
  } catch {
    return null;
  }
}

export function getSiteUrl() {
  const explicitSiteUrl = normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
  if (explicitSiteUrl) {
    return explicitSiteUrl;
  }

  for (const key of deploymentUrlEnvKeys) {
    const deploymentSiteUrl = normalizeSiteUrl(process.env[key]);
    if (deploymentSiteUrl) {
      return deploymentSiteUrl;
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    return 'http://localhost:3001';
  }

  return 'https://taskmarket.example';
}

export function absoluteUrl(path: string) {
  return new URL(path, `${getSiteUrl()}/`).toString();
}

export function publicTaskPath(taskId: string) {
  return `/tasks/${encodeURIComponent(taskId)}`;
}

export function publicAgentPath(agentId: string) {
  return `/agents/${encodeURIComponent(agentId)}`;
}

export function dashboardTaskPath(taskId: string) {
  return `/dashboard/tasks/${encodeURIComponent(taskId)}`;
}

export function dashboardAgentPath(agentId: string) {
  return `/dashboard/agents/${encodeURIComponent(agentId)}`;
}

export function truncateText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  if (maxLength <= 3) {
    return normalized.slice(0, maxLength);
  }

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function labelize(value: string) {
  return value.replaceAll('_', ' ');
}

function capitalize(value: string) {
  return value.length > 0 ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}

function metadataImage(path: string, alt: string) {
  return {
    alt,
    height: ogImageSize.height,
    url: path,
    width: ogImageSize.width,
  };
}

export function buildPageMetadata(input: SeoMetadataInput): Metadata {
  const imagePath = input.imagePath ?? defaultOgImagePath;
  const imageAlt = input.imageAlt ?? input.title;
  const shareTitle = input.ogTitle ?? input.title;
  // Spread rather than assigned, because the key has to be absent and not merely undefined.
  // Next injects the colocated opengraph-image.tsx only when the page's own metadata does not
  // `hasOwnProperty('images')` (see mergeStaticMetadata in next/dist/lib/metadata), so
  // `images: undefined` reads as "this page set its own images" and emits no card at all.
  const images = input.ownOgImage ? {} : { images: [metadataImage(imagePath, imageAlt)] };

  return {
    alternates: {
      canonical: input.path,
    },
    description: input.description,
    openGraph: {
      description: input.description,
      ...images,
      siteName,
      title: shareTitle,
      type: 'website',
      url: input.path,
    },
    title: input.title,
    twitter: {
      card: 'summary_large_image',
      description: input.description,
      ...images,
      title: shareTitle,
    },
  };
}

function withNoIndex(metadata: Metadata): Metadata {
  return {
    ...metadata,
    robots: {
      follow: true,
      index: false,
    },
  };
}

export function buildDashboardPageMetadata(input: SeoMetadataInput): Metadata {
  return withNoIndex(buildPageMetadata(input));
}

export function taskSeoTitle(task: Pick<TaskResponse, 'description' | 'id'>) {
  const firstLine = task.description
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return firstLine ? truncateText(firstLine, 80) : `Task ${task.id}`;
}

export function taskSeoDescription(
  task: Pick<TaskResponse, 'auctionType' | 'mode' | 'reward' | 'status' | 'tags'>
) {
  const mode =
    task.mode === 'auction' && task.auctionType
      ? `${capitalize(labelize(task.auctionType))} auction`
      : capitalize(labelize(task.mode));
  const parts = [
    `${mode} task.`,
    `Reward: ${formatUsdcUnits(task.reward)}.`,
    `Status: ${labelize(task.status)}.`,
  ];

  if (task.tags.length > 0) {
    parts.push(`Tags: ${task.tags.slice(0, 4).join(', ')}.`);
  }

  return truncateText(parts.join(' '), 180);
}

export function buildTaskMetadata(task: TaskResponse): Metadata {
  const title = taskSeoTitle(task);
  const path = publicTaskPath(task.id);

  return buildPageMetadata({
    description: taskSeoDescription(task),
    ownOgImage: true,
    path,
    title,
  });
}

export function buildDashboardTaskMetadata(task: TaskResponse): Metadata {
  const title = taskSeoTitle(task);
  const path = dashboardTaskPath(task.id);

  return buildDashboardPageMetadata({
    description: taskSeoDescription(task),
    ownOgImage: true,
    path,
    title,
  });
}

export function agentSeoTitle(agent: Pick<AgentStats | LeaderboardEntry, 'address' | 'agentId'>) {
  return actorDisplayName({ address: agent.address, agentId: agent.agentId });
}

export function agentSeoDescription(
  agent: Pick<
    AgentStats | LeaderboardEntry,
    'averageRating' | 'completedTasks' | 'skills' | 'totalEarnings'
  >
) {
  const rating = agent.averageRating > 0 ? agent.averageRating.toFixed(1) : 'N/A';
  const parts = [
    `${agent.completedTasks} completed tasks.`,
    `Rating: ${rating}.`,
    `Total earned: ${formatUsdcUnits(agent.totalEarnings)}.`,
  ];
  const skills = agent.skills ?? [];

  if (skills.length > 0) {
    parts.push(`Skills: ${skills.slice(0, 4).join(', ')}.`);
  }

  return truncateText(parts.join(' '), 180);
}

export function buildAgentMetadata(
  agent: AgentStats | LeaderboardEntry,
  routeId?: string
): Metadata {
  const title = agentSeoTitle(agent);
  const path = publicAgentPath(routeId ?? agent.agentId ?? agent.address);

  return buildPageMetadata({
    description: agentSeoDescription(agent),
    ownOgImage: true,
    path,
    title,
  });
}

export function buildDashboardAgentMetadata(
  agent: AgentStats | LeaderboardEntry,
  routeId?: string
): Metadata {
  const title = agentSeoTitle(agent);
  const path = dashboardAgentPath(routeId ?? agent.agentId ?? agent.address);

  return buildDashboardPageMetadata({
    description: agentSeoDescription(agent),
    ownOgImage: true,
    path,
    title,
  });
}

export function buildNoIndexMetadata(canonicalPath?: string): Metadata {
  return {
    alternates: canonicalPath
      ? {
          canonical: canonicalPath,
        }
      : undefined,
    robots: {
      follow: true,
      index: false,
    },
  };
}

export function decodeRouteParam(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

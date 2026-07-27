import type { Request, Response, NextFunction } from 'express';
import { db } from '../db/client';
import { tasks, agents } from '../db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { getAgentName } from '@taskmarket/shared';
import { taskDiscoverable } from '../lib/task-visibility';
import { logger } from '../lib/logger';
import { truncateText } from '../lib/email-format';

const SITE_URL = process.env.SITE_URL ?? 'http://localhost:3000';
const TASK_DESCRIPTION_PREVIEW_LENGTH = 500;

const BOT_PATTERNS = [
  'facebookexternalhit',
  'Facebot',
  'Twitterbot',
  'LinkedInBot',
  'Slackbot-LinkExpanding',
  'WhatsApp',
  'Telegram',
  'Discordbot',
  'Applebot',
  'Googlebot',
  'bingbot',
  // AI assistants and LLM crawlers
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'anthropic-ai',
  'ClaudeBot',
  'PerplexityBot',
  'YouBot',
  'cohere-ai',
];

function isSocialBot(userAgent: string | undefined): boolean {
  if (!userAgent) return false;
  return BOT_PATTERNS.some((pattern) => userAgent.includes(pattern));
}

interface OgMeta {
  title: string;
  description: string;
  url: string;
  imageAlt: string;
  bodyHtml?: string;
}

function buildOgHtml(meta: OgMeta): string {
  const imageUrl = `${SITE_URL}/og-image.png`;
  const bodyContent = meta.bodyHtml ?? `<p>${escapeHtml(meta.description)}</p>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(meta.title)}</title>
<meta name="description" content="${escapeHtml(meta.description)}" />
<meta property="og:type" content="website" />
<meta property="og:locale" content="en_US" />
<meta property="og:site_name" content="Taskmarket" />
<meta property="og:title" content="${escapeHtml(meta.title)}" />
<meta property="og:description" content="${escapeHtml(meta.description)}" />
<meta property="og:url" content="${escapeHtml(meta.url)}" />
<meta property="og:image" content="${escapeHtml(imageUrl)}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="${escapeHtml(meta.imageAlt)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeHtml(meta.title)}" />
<meta name="twitter:description" content="${escapeHtml(meta.description)}" />
<meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
<meta name="twitter:image:alt" content="${escapeHtml(meta.imageAlt)}" />
<link rel="canonical" href="${escapeHtml(meta.url)}" />
</head>
<body>
<h1>${escapeHtml(meta.title)}</h1>
${bodyContent}
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatUSDC(atomicUnits: string | number | null | undefined): string {
  const value = Number(atomicUnits ?? 0) / 1e6;
  return value.toFixed(3);
}

const STATIC_META: Record<string, Omit<OgMeta, 'bodyHtml'>> = {
  '/': {
    title: 'Taskmarket',
    description:
      'The open protocol for agent-to-agent commerce. Post tasks in USDC. Agents compete. Best work wins.',
    url: `${SITE_URL}/`,
    imageAlt: 'Taskmarket — the open protocol for agent-to-agent commerce',
  },
  '/tasks': {
    title: 'Tasks - Taskmarket',
    description:
      'Browse open tasks across all modes: bounty, claim, pitch, benchmark, and auction.',
    url: `${SITE_URL}/tasks`,
    imageAlt: 'Taskmarket tasks',
  },
  '/agents': {
    title: 'Agent Directory - Taskmarket',
    description: 'Discover top-performing agents on Taskmarket ranked by reputation.',
    url: `${SITE_URL}/agents`,
    imageAlt: 'Taskmarket agent directory',
  },
  '/leaderboard': {
    title: 'Leaderboard - Taskmarket',
    description: 'Top performing agents on Taskmarket by reputation and completed tasks.',
    url: `${SITE_URL}/leaderboard`,
    imageAlt: 'Taskmarket leaderboard',
  },
  '/protocol': {
    title: 'Protocol - Taskmarket',
    description:
      'Learn how the Taskmarket protocol works: escrow, identity, reputation, and task modes.',
    url: `${SITE_URL}/protocol`,
    imageAlt: 'Taskmarket protocol',
  },
};

async function buildHomepageBody(): Promise<string> {
  const recentTasks = await db
    .select({
      id: tasks.id,
      description: tasks.description,
      reward: tasks.reward,
      mode: tasks.mode,
      tags: tasks.tags,
    })
    .from(tasks)
    .where(and(eq(tasks.status, 'open'), taskDiscoverable))
    .orderBy(desc(tasks.createdAt))
    .limit(5);

  if (recentTasks.length === 0) {
    return `<p>${escapeHtml(STATIC_META['/'].description)}</p>`;
  }

  const items = recentTasks
    .map((t) => {
      const tags = t.tags.length > 0 ? ` [${t.tags.map(escapeHtml).join(', ')}]` : '';
      return `<li>${escapeHtml(t.description.slice(0, 100))} — ${escapeHtml(formatUSDC(t.reward))} USDC · ${escapeHtml(t.mode)}${tags}</li>`;
    })
    .join('\n');

  return `<p>${escapeHtml(STATIC_META['/'].description)}</p>\n<h2>Recent open tasks</h2>\n<ul>\n${items}\n</ul>`;
}

async function buildTasksBody(): Promise<string> {
  const taskList = await db
    .select({
      id: tasks.id,
      description: tasks.description,
      reward: tasks.reward,
      mode: tasks.mode,
      tags: tasks.tags,
    })
    .from(tasks)
    .where(and(eq(tasks.status, 'open'), taskDiscoverable))
    .orderBy(desc(tasks.createdAt))
    .limit(20);

  if (taskList.length === 0) {
    return `<p>${escapeHtml(STATIC_META['/tasks'].description)}</p>`;
  }

  const items = taskList
    .map((t) => {
      const tags = t.tags.length > 0 ? ` [${t.tags.map(escapeHtml).join(', ')}]` : '';
      return `<li><a href="${escapeHtml(`${SITE_URL}/tasks/${t.id}`)}">${escapeHtml(t.description.slice(0, 100))}</a> — ${escapeHtml(formatUSDC(t.reward))} USDC · ${escapeHtml(t.mode)}${tags}</li>`;
    })
    .join('\n');

  return `<p>${escapeHtml(STATIC_META['/tasks'].description)}</p>\n<ul>\n${items}\n</ul>`;
}

async function buildAgentsBody(forLeaderboard = false): Promise<string> {
  const agentList = await db
    .select({
      agentId: agents.agentId,
      address: agents.address,
      completedTasks: agents.completedTasks,
      ratedTasks: agents.ratedTasks,
      totalStars: agents.totalStars,
      skills: agents.skills,
    })
    .from(agents)
    .orderBy(desc(agents.completedTasks))
    .limit(20);

  const staticKey = forLeaderboard ? '/leaderboard' : '/agents';

  if (agentList.length === 0) {
    return `<p>${escapeHtml(STATIC_META[staticKey].description)}</p>`;
  }

  const items = agentList
    .map((a) => {
      const label = a.agentId
        ? (getAgentName(a.agentId) ?? `Agent #${a.agentId}`)
        : a.address.slice(0, 10);
      const rating = a.ratedTasks > 0 ? (a.totalStars / a.ratedTasks).toFixed(1) : 'N/A';
      const skills = a.skills.length > 0 ? ` · ${a.skills.map(escapeHtml).join(', ')}` : '';
      return `<li><a href="${escapeHtml(`${SITE_URL}/agents/${a.agentId ?? a.address}`)}">${escapeHtml(label)}</a> — ${a.completedTasks} tasks · Rating: ${escapeHtml(rating)}${skills}</li>`;
    })
    .join('\n');

  return `<p>${escapeHtml(STATIC_META[staticKey].description)}</p>\n<ul>\n${items}\n</ul>`;
}

export async function ogTagsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!isSocialBot(req.headers['user-agent'])) {
    next();
    return;
  }

  const pathname = req.path;

  // Pages with DB-enriched body content
  if (pathname === '/') {
    try {
      const bodyHtml = await buildHomepageBody();
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(buildOgHtml({ ...STATIC_META['/'], bodyHtml }));
      return;
    } catch {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(buildOgHtml(STATIC_META['/']));
      return;
    }
  }

  if (pathname === '/tasks') {
    try {
      const bodyHtml = await buildTasksBody();
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(buildOgHtml({ ...STATIC_META['/tasks'], bodyHtml }));
      return;
    } catch {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(buildOgHtml(STATIC_META['/tasks']));
      return;
    }
  }

  if (pathname === '/agents') {
    try {
      const bodyHtml = await buildAgentsBody(false);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(buildOgHtml({ ...STATIC_META['/agents'], bodyHtml }));
      return;
    } catch {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(buildOgHtml(STATIC_META['/agents']));
      return;
    }
  }

  if (pathname === '/leaderboard') {
    try {
      const bodyHtml = await buildAgentsBody(true);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(buildOgHtml({ ...STATIC_META['/leaderboard'], bodyHtml }));
      return;
    } catch {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(buildOgHtml(STATIC_META['/leaderboard']));
      return;
    }
  }

  // Static page with no DB data needed
  if (pathname === '/protocol') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(buildOgHtml(STATIC_META['/protocol']));
    return;
  }

  // /tasks/:taskId
  const taskMatch = pathname.match(/^\/tasks\/([^/]+)$/);
  if (taskMatch) {
    const taskId = taskMatch[1];
    try {
      const rows = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, taskId), taskDiscoverable))
        .limit(1);
      if (rows.length > 0) {
        const task = rows[0];
        const title = `${task.description.slice(0, 60)} - Taskmarket`;
        const description = `${task.mode} task · ${formatUSDC(task.reward)} USDC reward · Status: ${task.status}`;
        const lines = [
          `<p>${escapeHtml(truncateText(task.description, TASK_DESCRIPTION_PREVIEW_LENGTH))}</p>`,
          '<ul>',
          `<li>Mode: ${escapeHtml(task.mode)}</li>`,
          `<li>Reward: ${escapeHtml(formatUSDC(task.reward))} USDC</li>`,
          `<li>Status: ${escapeHtml(task.status)}</li>`,
          task.tags.length > 0 ? `<li>Tags: ${task.tags.map(escapeHtml).join(', ')}</li>` : '',
          '</ul>',
        ]
          .filter(Boolean)
          .join('\n');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(
          buildOgHtml({
            title,
            description,
            url: `${SITE_URL}/tasks/${task.id}`,
            imageAlt: task.description.slice(0, 100),
            bodyHtml: lines,
          })
        );
        return;
      }
    } catch (err) {
      // Fall through to generic fallback on DB error
      logger.warn('ogTags: task lookup failed', { err, taskId });
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(buildOgHtml(STATIC_META['/tasks']));
    return;
  }

  // /agents/:agentId
  const agentMatch = pathname.match(/^\/agents\/([^/]+)$/);
  if (agentMatch) {
    const agentId = agentMatch[1];
    try {
      const rows = await db.select().from(agents).where(eq(agents.agentId, agentId)).limit(1);
      if (rows.length > 0) {
        const agent = rows[0];
        const agentName = agent.agentId
          ? (getAgentName(agent.agentId) ?? `Agent #${agent.agentId}`)
          : agentId;
        const label = agent.agentId ? `${agentName} (#${agent.agentId})` : agentId;
        const averageRating =
          agent.ratedTasks > 0 ? (agent.totalStars / agent.ratedTasks).toFixed(1) : 'N/A';
        const skillsSuffix =
          agent.skills && agent.skills.length > 0 ? ` · ${agent.skills.join(', ')}` : '';
        const description = `${agent.completedTasks} tasks completed · Rating: ${averageRating}${skillsSuffix}`;
        const lines = [
          '<ul>',
          `<li>Completed tasks: ${agent.completedTasks}</li>`,
          `<li>Average rating: ${escapeHtml(averageRating)}</li>`,
          agent.skills.length > 0
            ? `<li>Skills: ${agent.skills.map(escapeHtml).join(', ')}</li>`
            : '',
          `<li>Address: ${escapeHtml(agent.address)}</li>`,
          '</ul>',
        ]
          .filter(Boolean)
          .join('\n');
        const ogTitle = agent.agentId
          ? `${agentName} (#${agent.agentId}) – Taskmarket`
          : `${label} - Taskmarket`;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(
          buildOgHtml({
            title: ogTitle,
            description,
            url: `${SITE_URL}/agents/${agentId}`,
            imageAlt: `${agentName} on Taskmarket`,
            bodyHtml: lines,
          })
        );
        return;
      }
    } catch (err) {
      // Fall through to generic fallback on DB error
      logger.warn('ogTags: agent lookup failed', { err, agentId });
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(buildOgHtml(STATIC_META['/agents']));
    return;
  }

  next();
}

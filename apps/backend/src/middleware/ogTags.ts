import type { Request, Response, NextFunction } from 'express';
import { db } from '../db/client';
import { tasks, agents } from '../db/schema';
import { eq } from 'drizzle-orm';

const SITE_URL = process.env.SITE_URL ?? 'http://localhost:3000';

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
  bodyContent?: string;
}

function buildOgHtml(meta: OgMeta): string {
  const imageUrl = `${SITE_URL}/og-image.png`;
  const body = meta.bodyContent ? escapeHtml(meta.bodyContent) : escapeHtml(meta.description);
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
<p>${body}</p>
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

const STATIC_PAGES: Record<string, OgMeta> = {
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

  // Static pages
  const staticMeta = STATIC_PAGES[pathname];
  if (staticMeta) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(buildOgHtml(staticMeta));
    return;
  }

  // /tasks/:taskId
  const taskMatch = pathname.match(/^\/tasks\/([^/]+)$/);
  if (taskMatch) {
    const taskId = taskMatch[1];
    try {
      const rows = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
      if (rows.length > 0) {
        const task = rows[0];
        const title = `${task.description.slice(0, 60)} - Taskmarket`;
        const description = `${task.mode} task · ${formatUSDC(task.reward)} USDC reward · Status: ${task.status}`;
        const bodyContent = [
          task.description,
          `Mode: ${task.mode}`,
          `Reward: ${formatUSDC(task.reward)} USDC`,
          `Status: ${task.status}`,
          task.tags && task.tags.length > 0 ? `Tags: ${task.tags.join(', ')}` : '',
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
            bodyContent,
          })
        );
        return;
      }
    } catch {
      // Fall through to next() on DB error
    }
    // Task not found — serve generic fallback
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(buildOgHtml(STATIC_PAGES['/tasks']));
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
        const label = agent.agentId ? `Agent #${agent.agentId}` : agentId;
        const averageRating =
          agent.ratedTasks > 0 ? (agent.totalStars / agent.ratedTasks).toFixed(1) : 'N/A';
        const skillsSuffix =
          agent.skills && agent.skills.length > 0 ? ` · ${agent.skills.join(', ')}` : '';
        const description = `${agent.completedTasks} tasks completed · Rating: ${averageRating}${skillsSuffix}`;
        const bodyContent = [
          `Agent: ${label}`,
          `Completed tasks: ${agent.completedTasks}`,
          `Average rating: ${averageRating}`,
          agent.skills && agent.skills.length > 0 ? `Skills: ${agent.skills.join(', ')}` : '',
          `Address: ${agent.address}`,
        ]
          .filter(Boolean)
          .join('\n');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(
          buildOgHtml({
            title: `${label} - Taskmarket`,
            description,
            url: `${SITE_URL}/agents/${agentId}`,
            imageAlt: `${label} on Taskmarket`,
            bodyContent,
          })
        );
        return;
      }
    } catch {
      // Fall through to next() on DB error
    }
    // Agent not found — serve generic fallback
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(buildOgHtml(STATIC_PAGES['/agents']));
    return;
  }

  next();
}

import type { MetadataRoute } from 'next';

import { absoluteUrl } from '@/lib/seo';

// Link-preview crawlers. These fetch a URL only to read its OG tags and render a share
// card; they do not index and they do not follow the page into the app. The blanket
// `Disallow: /dashboard` below also blocked them, which is why every /dashboard link
// pasted into X, Discord or Telegram came back with no preview at all — not a broken
// image, no card whatsoever, because the crawler never requested the page.
//
// Search engines stay blocked from /dashboard by the `*` rule, and the dashboard pages we are
// adding cards to (/dashboard, /dashboard/tasks, /dashboard/tasks/new) each carry their own
// `robots: { index: false }` via buildDashboardPageMetadata, so allowing these agents does not
// put app screens into anyone's search index.
//
// TODO(Loaf): /dashboard/inbox and /dashboard/account use plain buildPageMetadata, so they have
// no noindex backstop and become reachable by these agents. Worth switching both to
// buildDashboardPageMetadata.
//
// Verify on the preview before trusting this: Twitterbot is widely reported to skip card
// generation on pages marked noindex. If that turns out to be true here, the dashboard cards
// are moot and we simply share the public twins (/tasks, /tasks/[id]) instead — which is the
// better link anyway. Check one dashboard URL in the X Card Validator.
const LINK_PREVIEW_USER_AGENTS = [
  'Twitterbot',
  'facebookexternalhit',
  'Discordbot',
  'LinkedInBot',
  'Slackbot-LinkExpanding',
  'TelegramBot',
  'WhatsApp',
] as const;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        allow: '/',
        disallow: ['/dashboard', '/dashboard/'],
        userAgent: '*',
      },
      ...LINK_PREVIEW_USER_AGENTS.map((userAgent) => ({
        allow: '/',
        userAgent,
      })),
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}

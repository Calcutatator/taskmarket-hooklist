import { createFileRoute } from '@tanstack/react-router';
import { Helmet } from 'react-helmet-async';
import { AgentDirectoryView } from '@/components/views/AgentDirectoryView';

const SITE_URL = import.meta.env.VITE_SITE_URL ?? 'https://market.daydreams.systems';

function AgentDirectoryRoute() {
  return (
    <>
      <Helmet>
        <title>Agent Directory - Taskmarket</title>
        <meta
          name="description"
          content="Discover top-performing agents on Taskmarket ranked by reputation."
        />
        <meta property="og:title" content="Agent Directory - Taskmarket" />
        <meta
          property="og:description"
          content="Discover top-performing agents on Taskmarket ranked by reputation."
        />
        <meta property="og:url" content={`${SITE_URL}/agents`} />
        <meta property="og:image" content={`${SITE_URL}/og-image.png`} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <link rel="canonical" href={`${SITE_URL}/agents`} />
        <meta name="twitter:title" content="Agent Directory - Taskmarket" />
        <meta
          name="twitter:description"
          content="Discover top-performing agents on Taskmarket ranked by reputation."
        />
        <meta name="twitter:image" content={`${SITE_URL}/og-image.png`} />
      </Helmet>
      <AgentDirectoryView />
    </>
  );
}

export const Route = createFileRoute('/agents/')({
  validateSearch: (
    search: Record<string, unknown>
  ): {
    sort?: 'reputation' | 'tasks';
    skill?: string;
    search?: string;
    page?: number;
    limit?: number;
    minRating?: number;
    minTasks?: number;
  } => ({
    sort: search.sort === 'reputation' || search.sort === 'tasks' ? search.sort : undefined,
    skill: typeof search.skill === 'string' && search.skill ? search.skill : undefined,
    search: typeof search.search === 'string' && search.search ? search.search : undefined,
    page: typeof search.page === 'number' && search.page > 1 ? Math.floor(search.page) : undefined,
    limit:
      typeof search.limit === 'number' && [10, 20, 50].includes(search.limit)
        ? search.limit
        : undefined,
    minRating:
      typeof search.minRating === 'number' && [3, 4, 4.5].includes(search.minRating)
        ? search.minRating
        : undefined,
    minTasks:
      typeof search.minTasks === 'number' && [5, 10, 50].includes(search.minTasks)
        ? search.minTasks
        : undefined,
  }),
  component: AgentDirectoryRoute,
});

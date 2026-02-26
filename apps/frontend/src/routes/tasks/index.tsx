import { createFileRoute } from '@tanstack/react-router';
import { Helmet } from 'react-helmet-async';
import { TasksView } from '@/components/views/TasksView';

const SITE_URL = import.meta.env.VITE_SITE_URL ?? 'https://market.daydreams.systems';

function TasksRoute() {
  return (
    <>
      <Helmet>
        <title>Tasks - Taskmarket</title>
        <meta
          name="description"
          content="Browse open tasks across all modes: bounty, claim, pitch, benchmark, and auction."
        />
        <meta property="og:title" content="Tasks - Taskmarket" />
        <meta
          property="og:description"
          content="Browse open tasks across all modes: bounty, claim, pitch, benchmark, and auction."
        />
        <meta property="og:url" content={`${SITE_URL}/tasks`} />
        <meta property="og:image" content={`${SITE_URL}/og-image.png`} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <link rel="canonical" href={`${SITE_URL}/tasks`} />
        <meta name="twitter:title" content="Tasks - Taskmarket" />
        <meta
          name="twitter:description"
          content="Browse open tasks across all modes: bounty, claim, pitch, benchmark, and auction."
        />
        <meta name="twitter:image" content={`${SITE_URL}/og-image.png`} />
      </Helmet>
      <TasksView />
    </>
  );
}

export const Route = createFileRoute('/tasks/')({
  validateSearch: (search: Record<string, unknown>): { q?: string } => ({
    q: typeof search.q === 'string' && search.q ? search.q : undefined,
  }),
  component: TasksRoute,
});

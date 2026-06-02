import { createFileRoute } from '@tanstack/react-router';
import { Helmet } from 'react-helmet-async';
import { CreateTaskView } from '@/components/views/CreateTaskView';

const SITE_URL = import.meta.env.VITE_SITE_URL ?? 'https://taskmarket.dev';

function CreateTaskRoute() {
  return (
    <>
      <Helmet>
        <title>Create Task - Taskmarket</title>
        <meta name="description" content="Post a new task to the Taskmarket protocol." />
        <meta property="og:title" content="Create Task - Taskmarket" />
        <meta property="og:description" content="Post a new task to the Taskmarket protocol." />
        <meta property="og:url" content={`${SITE_URL}/tasks/new`} />
        <meta property="og:image" content={`${SITE_URL}/og-image.png`} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <link rel="canonical" href={`${SITE_URL}/tasks/new`} />
        <meta name="twitter:title" content="Create Task - Taskmarket" />
        <meta name="twitter:description" content="Post a new task to the Taskmarket protocol." />
        <meta name="twitter:image" content={`${SITE_URL}/og-image.png`} />
      </Helmet>
      <CreateTaskView />
    </>
  );
}

export const Route = createFileRoute('/tasks/new')({
  component: CreateTaskRoute,
});

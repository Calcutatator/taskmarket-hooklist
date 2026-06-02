import { createFileRoute } from '@tanstack/react-router';
import { Helmet } from 'react-helmet-async';
import { LandingView } from '@/components/views/LandingView';

const SITE_URL = import.meta.env.VITE_SITE_URL ?? 'https://taskmarket.dev';

function HomeRoute() {
  return (
    <>
      <Helmet>
        <title>Taskmarket</title>
        <meta
          name="description"
          content="The open protocol for agent-to-agent commerce. Post tasks in USDC. Agents compete. Best work wins."
        />
        <meta property="og:title" content="Taskmarket" />
        <meta
          property="og:description"
          content="The open protocol for agent-to-agent commerce. Post tasks in USDC. Agents compete. Best work wins."
        />
        <meta property="og:url" content={`${SITE_URL}/`} />
        <meta property="og:image" content={`${SITE_URL}/og-image.png`} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <link rel="canonical" href={`${SITE_URL}/`} />
        <meta name="twitter:title" content="Taskmarket" />
        <meta
          name="twitter:description"
          content="The open protocol for agent-to-agent commerce. Post tasks in USDC. Agents compete. Best work wins."
        />
        <meta name="twitter:image" content={`${SITE_URL}/og-image.png`} />
      </Helmet>
      <LandingView />
    </>
  );
}

export const Route = createFileRoute('/')({
  component: HomeRoute,
});

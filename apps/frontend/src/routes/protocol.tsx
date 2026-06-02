import { createFileRoute } from '@tanstack/react-router';
import { Helmet } from 'react-helmet-async';
import { ProtocolView } from '@/components/views/ProtocolView';

const SITE_URL = import.meta.env.VITE_SITE_URL ?? 'https://taskmarket.dev';

function ProtocolRoute() {
  return (
    <>
      <Helmet>
        <title>Protocol - Taskmarket</title>
        <meta
          name="description"
          content="Learn how the Taskmarket protocol works: escrow, identity, reputation, and task modes."
        />
        <meta property="og:title" content="Protocol - Taskmarket" />
        <meta
          property="og:description"
          content="Learn how the Taskmarket protocol works: escrow, identity, reputation, and task modes."
        />
        <meta property="og:url" content={`${SITE_URL}/protocol`} />
        <meta property="og:image" content={`${SITE_URL}/og-image.png`} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <link rel="canonical" href={`${SITE_URL}/protocol`} />
        <meta name="twitter:title" content="Protocol - Taskmarket" />
        <meta
          name="twitter:description"
          content="Learn how the Taskmarket protocol works: escrow, identity, reputation, and task modes."
        />
        <meta name="twitter:image" content={`${SITE_URL}/og-image.png`} />
      </Helmet>
      <ProtocolView />
    </>
  );
}

export const Route = createFileRoute('/protocol')({
  component: ProtocolRoute,
});

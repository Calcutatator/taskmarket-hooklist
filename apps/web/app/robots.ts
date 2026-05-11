import type { MetadataRoute } from 'next';

import { absoluteUrl } from '@/lib/seo';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      allow: '/',
      disallow: ['/dashboard', '/dashboard/'],
      userAgent: '*',
    },
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}

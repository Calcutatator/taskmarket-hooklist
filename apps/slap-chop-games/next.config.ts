import type { NextConfig } from 'next';

import { getEnvironment } from '@/lib/environment';

// Implements: ADR-0087
const environment = getEnvironment();
const apiUrl = environment.TASKMARKET_API_URL ?? environment.NEXT_PUBLIC_API_URL;

const securityHeaders = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  {
    key: 'Permissions-Policy',
    value:
      'accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
  },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  async headers() {
    return [
      {
        headers: securityHeaders,
        source: '/:path*',
      },
    ];
  },
  async rewrites() {
    if (!apiUrl) {
      return [];
    }

    const normalizedApiUrl = apiUrl.replace(/\/+$/, '');

    return [
      {
        destination: `${normalizedApiUrl}/api/:path*`,
        source: '/api/:path*',
      },
      {
        destination: `${normalizedApiUrl}/trpc/:path*`,
        source: '/trpc/:path*',
      },
    ];
  },
};

export default nextConfig;

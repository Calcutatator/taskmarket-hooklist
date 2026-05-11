import type { NextConfig } from 'next';

const apiUrl =
  process.env.TASKMARKET_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  async rewrites() {
    return [
      {
        destination: `${apiUrl.replace(/\/+$/, '')}/api/:path*`,
        source: '/api/:path*',
      },
      {
        destination: `${apiUrl.replace(/\/+$/, '')}/trpc/:path*`,
        source: '/trpc/:path*',
      },
    ];
  },
};

export default nextConfig;

import { NextResponse, type NextRequest } from 'next/server';

const dashboardRoutePrefixes = new Map([
  ['/agents', '/dashboard/agents'],
  ['/leaderboard', '/dashboard/leaderboard'],
  ['/protocol', '/dashboard/protocol'],
  ['/tasks', '/dashboard/tasks'],
]);

export function dashboardRedirectPath(pathname: string) {
  if (pathname.endsWith('/opengraph-image')) {
    return null;
  }

  for (const [publicPrefix, dashboardPrefix] of dashboardRoutePrefixes) {
    if (pathname === publicPrefix) {
      return dashboardPrefix;
    }

    if (pathname.startsWith(`${publicPrefix}/`)) {
      return pathname.replace(publicPrefix, dashboardPrefix);
    }
  }

  return null;
}

export function proxy(request: NextRequest) {
  const redirectPath = dashboardRedirectPath(request.nextUrl.pathname);

  if (!redirectPath) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = redirectPath;

  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/agents/:path*', '/leaderboard', '/protocol', '/tasks/:path*'],
};

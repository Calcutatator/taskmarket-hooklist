import { NextResponse, type NextRequest } from 'next/server';

// The public market routes (/tasks, /agents, /leaderboard, /protocol, /humans)
// now render first-class public pages, so the middleware no longer redirects
// them into /dashboard. It is kept as a pass-through to preserve the proxy and
// config exports and leave room for any future route rewrites.
export function proxy(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [],
};

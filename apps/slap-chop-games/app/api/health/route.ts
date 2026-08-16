import { NextResponse } from 'next/server';

import { getEnvironment } from '@/lib/environment';

// Implements: ADR-0087
export const dynamic = 'force-dynamic';

export async function GET() {
  const environment = getEnvironment();

  return NextResponse.json(
    {
      commitSha: environment.COMMIT_SHA ?? 'development',
      deployEnvironment: environment.DEPLOY_ENVIRONMENT,
      service: 'slap-chop-games',
      status: 'ok',
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}

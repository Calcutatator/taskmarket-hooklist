import { GameListInputSchema } from '@taskmarket/shared';

import { proxyCatalogRead } from '@/lib/catalog-route';
import { getEnvironment } from '@/lib/environment';
import { listLiveCatalog } from '@/lib/live-catalog';

export const dynamic = 'force-dynamic';

function liveListInput(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const limit = searchParams.get('limit');

  return GameListInputSchema.safeParse({
    cursor: searchParams.get('cursor') ?? undefined,
    limit: limit === null ? undefined : Number(limit),
    query: searchParams.get('query') ?? undefined,
  });
}

// Implements: ADR-0091. Only catalog reads may cross from a development build to production.
export async function GET(request: Request): Promise<Response> {
  if (getEnvironment().SLAP_CHOP_DATA_MODE !== 'live-readonly') {
    return proxyCatalogRead(request, '/api/games');
  }

  const input = liveListInput(request);
  if (!input.success) {
    return Response.json(
      { message: 'Invalid game catalog query.' },
      { headers: { 'Cache-Control': 'no-store' }, status: 400 }
    );
  }

  try {
    return Response.json(await listLiveCatalog(input.data), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return Response.json(
      { message: 'The read-only production game source is unavailable.' },
      { headers: { 'Cache-Control': 'no-store' }, status: 503 }
    );
  }
}

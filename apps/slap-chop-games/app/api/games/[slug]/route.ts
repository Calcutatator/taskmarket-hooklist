import { proxyCatalogRead } from '@/lib/catalog-route';
import { getEnvironment } from '@/lib/environment';
import { getLiveGameDetail } from '@/lib/live-catalog';

export const dynamic = 'force-dynamic';

// Implements: ADR-0091. The browser refreshes a bounded same-origin detail route and never
// receives the production storage URL used behind the artifact proxy.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params;
  if (getEnvironment().SLAP_CHOP_DATA_MODE !== 'live-readonly') {
    return proxyCatalogRead(request, `/api/games/${encodeURIComponent(slug)}`);
  }

  try {
    const game = await getLiveGameDetail(slug);
    if (!game) {
      return Response.json(
        { message: 'The game is not in the read-only production catalog.' },
        { headers: { 'Cache-Control': 'no-store' }, status: 404 }
      );
    }

    return Response.json(game, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return Response.json(
      { message: 'The read-only production game source is unavailable.' },
      { headers: { 'Cache-Control': 'no-store' }, status: 503 }
    );
  }
}

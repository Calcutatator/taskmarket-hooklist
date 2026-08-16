import { getEnvironmentApiBaseUrl } from '@/lib/catalog-api';

export async function proxyCatalogRead(request: Request, path: string): Promise<Response> {
  const target = new URL(path, `${getEnvironmentApiBaseUrl().replace(/\/+$/, '')}/`);
  target.search = new URL(request.url).search;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return Response.json(
      { message: 'The Taskmarket game catalog is unavailable.' },
      { headers: { 'Cache-Control': 'no-store' }, status: 503 }
    );
  }

  return new Response(upstream.body, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
    },
    status: upstream.status,
  });
}

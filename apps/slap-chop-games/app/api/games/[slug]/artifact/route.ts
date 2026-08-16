import { getEnvironment } from '@/lib/environment';
import { getLiveGameArtifact } from '@/lib/live-catalog';

export const dynamic = 'force-dynamic';

function unavailable(status: number): Response {
  return Response.json(
    { message: 'The pinned production game artifact is unavailable.' },
    { headers: { 'Cache-Control': 'no-store' }, status }
  );
}

// Implements: ADR-0091. This exact-slug proxy removes the storage CORS dependency while the
// shared runtime still verifies the bytes again before executing them in the closed sandbox.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  if (getEnvironment().SLAP_CHOP_DATA_MODE !== 'live-readonly') {
    return unavailable(404);
  }

  const { slug } = await params;
  try {
    const artifact = await getLiveGameArtifact(slug);
    if (!artifact) return unavailable(404);
    const body = new ArrayBuffer(artifact.bytes.byteLength);
    new Uint8Array(body).set(artifact.bytes);

    return new Response(body, {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="${artifact.fileName}"`,
        'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; sandbox",
        'Content-Type': 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return unavailable(502);
  }
}

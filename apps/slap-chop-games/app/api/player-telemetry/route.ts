import { NextResponse } from 'next/server';

import { parsePlayerTelemetryPayload } from '@/lib/player-telemetry';

const MAX_PLAYER_TELEMETRY_BYTES = 256;

// Implements: ADR-0087. This app-owned endpoint accepts only a tiny, enum-only operational
// signal. It is intentionally not an analytics or identity collection surface.
export const dynamic = 'force-dynamic';

function noContent(): NextResponse {
  return new NextResponse(null, {
    headers: {
      'Cache-Control': 'no-store',
    },
    status: 204,
  });
}

function declaredBodyExceedsLimit(request: Request): boolean {
  const contentLength = request.headers.get('content-length');
  if (!contentLength) return false;

  const bytes = Number(contentLength);
  return !Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_PLAYER_TELEMETRY_BYTES;
}

async function readBoundedJson(request: Request): Promise<unknown | null> {
  if (declaredBodyExceedsLimit(request) || !request.body) {
    return null;
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let complete = false;

  try {
    while (!complete) {
      const { done, value } = await reader.read();
      complete = done;
      if (done) continue;
      if (!value) continue;

      length += value.byteLength;
      if (length > MAX_PLAYER_TELEMETRY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const payload = parsePlayerTelemetryPayload(await readBoundedJson(request));
  if (!payload) {
    return noContent();
  }

  // JSON makes Railway's application log record structured while the whitelist above guarantees
  // these fields cannot carry input-derived identifiers or content.
  console.warn(
    JSON.stringify({
      event: 'slap_chop.player_failure',
      outcome: 'failure',
      playerEvent: payload.event,
      reason: payload.reason,
    })
  );

  return noContent();
}

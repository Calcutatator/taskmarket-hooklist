import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

const port = Number(process.env.SLAP_CHOP_E2E_API_PORT ?? 3107);
const defaultGameHtml =
  '<!doctype html><html><body><main id="game-ready">Verified catalog game</main></body></html>';
const publishedAt = '2026-08-16T00:00:00.000Z';
const maxReleaseScenarioDelayMs = 1_000;
const eagerCoverFailureSlug = 'solar-orbit-8';
const securitySinkRequests = [];
const securitySinkUrl = `http://127.0.0.1:${port}/test/security-sink`;
const sandboxJailDataProbeReadyLog = 'taskmarket:sandbox-jail-data-probe-ready';
const sandboxJailDataNavigationLog = 'taskmarket:sandbox-jail-data-navigation-fired';
const sandboxJailDataDocumentReadyLog = 'taskmarket:sandbox-jail-data-document-ready';
const sandboxJailDataDocumentAttacksLog = 'taskmarket:sandbox-jail-data-document-attacks-fired';
const sandboxJailHttpProbeReadyLog = 'taskmarket:sandbox-jail-http-probe-ready';
const sandboxJailHttpNavigationLog = 'taskmarket:sandbox-jail-http-navigation-fired';
const sandboxJailDataDocumentHtml = `<!doctype html>
<html>
  <body>
    <main id="sandbox-jail-data-document">Sandbox jail data document</main>
    <script>
      console.log(${JSON.stringify(sandboxJailDataDocumentReadyLog)});
      const sink = ${JSON.stringify(securitySinkUrl)};

      const image = new Image();
      image.src = sink + '?via=data-image';

      fetch(sink + '?via=data-fetch').catch(function () {});

      const refresh = document.createElement('meta');
      refresh.httpEquiv = 'refresh';
      refresh.content = '0;url=' + sink + '?via=data-meta';
      document.head.append(refresh);

      console.log(${JSON.stringify(sandboxJailDataDocumentAttacksLog)});
    </script>
  </body>
</html>`;
const sandboxJailDataDocumentUrl = `data:text/html;base64,${Buffer.from(
  sandboxJailDataDocumentHtml
).toString('base64')}`;
const sandboxJailDataProbeHtml = `<!doctype html>
<html>
  <body>
    <main id="sandbox-jail-data-probe">Sandbox jail data probe</main>
    <script>
      console.log(${JSON.stringify(sandboxJailDataProbeReadyLog)});
      window.setTimeout(function () {
        console.log(${JSON.stringify(sandboxJailDataNavigationLog)});
        window.location.assign(${JSON.stringify(sandboxJailDataDocumentUrl)});
      }, 1000);
    </script>
  </body>
</html>`;
const sandboxJailHttpProbeHtml = `<!doctype html>
<html>
  <body>
    <main id="sandbox-jail-http-probe">Sandbox jail HTTP probe</main>
    <script>
      console.log(${JSON.stringify(sandboxJailHttpProbeReadyLog)});
      window.setTimeout(function () {
        console.log(${JSON.stringify(sandboxJailHttpNavigationLog)});
        window.location.assign(${JSON.stringify(`${securitySinkUrl}?via=http-location`)});
      }, 1000);
    </script>
  </body>
</html>`;

const releaseScenario = {
  artifact: { delayMs: 0, status: 200 },
  catalog: { delayMs: 0, status: 200 },
};

const games = Array.from({ length: 48 }, (_, index) => {
  const ordinal = index + 1;
  const slug =
    ordinal === 1
      ? 'silent-orbit'
      : ordinal === 2
        ? 'sandbox-jail-data-probe'
        : ordinal === 3
          ? 'sandbox-jail-http-probe'
          : `solar-orbit-${ordinal}`;

  return {
    coverAltText: null,
    coverUrl: ordinal <= 8 ? `http://127.0.0.1:${port}/covers/${slug}.svg` : null,
    creatorName: 'North Field',
    description:
      ordinal === 2
        ? 'A browser-level data navigation egress probe for the nested game jail.'
        : ordinal === 3
          ? 'A browser-level HTTP navigation egress probe for the nested game jail.'
          : `A verified arcade orbit ${ordinal}.`,
    downvoteCount: ordinal % 3,
    id: `game-${ordinal}`,
    netVotes: 60 - ordinal,
    publishedAt,
    slug,
    tags: ['arcade', 'space'],
    title:
      ordinal === 1
        ? 'Silent Orbit'
        : ordinal === 2
          ? 'Sandbox Jail Data Probe'
          : ordinal === 3
            ? 'Sandbox Jail HTTP Probe'
            : `Solar Orbit ${ordinal}`,
    upvoteCount: 60,
  };
});

function writeJson(response, value, status = 200) {
  response.writeHead(status, {
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(value));
}

function writeCover(response) {
  response.writeHead(200, {
    'cache-control': 'no-store',
    'content-type': 'image/svg+xml; charset=utf-8',
  });
  response.end(
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800"><rect width="800" height="800" fill="#191915"/><circle cx="400" cy="400" r="180" fill="#f4f1e8"/></svg>'
  );
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizedDelay(value) {
  if (!Number.isInteger(value)) {
    return 0;
  }

  return Math.min(Math.max(value, 0), maxReleaseScenarioDelayMs);
}

function normalizedStatus(value) {
  if (!Number.isInteger(value) || value < 400 || value > 599) {
    return 200;
  }

  return value;
}

function resetReleaseScenario() {
  releaseScenario.artifact = { delayMs: 0, status: 200 };
  releaseScenario.catalog = { delayMs: 0, status: 200 };
}

async function configureReleaseScenario(request) {
  let body = '';

  for await (const chunk of request) {
    body += chunk;
  }

  try {
    const parsed = JSON.parse(body);

    releaseScenario.artifact = {
      delayMs: normalizedDelay(parsed?.artifact?.delayMs),
      status: normalizedStatus(parsed?.artifact?.status),
    };
    releaseScenario.catalog = {
      delayMs: normalizedDelay(parsed?.catalog?.delayMs),
      status: normalizedStatus(parsed?.catalog?.status),
    };
    return true;
  } catch {
    return false;
  }
}

function artifactHtml(game) {
  if (game.slug === 'sandbox-jail-data-probe') {
    return sandboxJailDataProbeHtml;
  }

  if (game.slug === 'sandbox-jail-http-probe') {
    return sandboxJailHttpProbeHtml;
  }

  return defaultGameHtml;
}

function sha256(html) {
  return createHash('sha256').update(html).digest('hex');
}

function writeHtml(response, html) {
  response.writeHead(200, {
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(html)),
    'content-type': 'text/html; charset=utf-8',
  });
  response.end(html);
}

function gameDetail(game) {
  const html = artifactHtml(game);

  return {
    ...game,
    artifactUrl: `http://127.0.0.1:${port}/artifacts/${game.slug}.html`,
    artifactUrlExpiresAt: '2026-08-16T01:00:00.000Z',
    source: {
      artifactId: `artifact-${game.slug}`,
      artifactKeccak256Hash: `0x${'1'.repeat(64)}`,
      artifactMimeType: 'text/html',
      artifactSha256Hash: sha256(html),
      artifactSizeBytes: Buffer.byteLength(html),
      submissionId: `submission-${game.slug}`,
      taskId: `task-${game.slug}`,
    },
  };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);

  if (url.pathname === '/health') {
    writeJson(response, { ok: true });
    return;
  }

  if (url.pathname === '/api/games') {
    await delay(releaseScenario.catalog.delayMs);

    if (releaseScenario.catalog.status !== 200) {
      writeJson(response, { error: 'Catalog unavailable' }, releaseScenario.catalog.status);
      return;
    }

    writeJson(response, { games, nextCursor: null });
    return;
  }

  if (url.pathname.startsWith('/api/games/')) {
    const slug = decodeURIComponent(url.pathname.slice('/api/games/'.length));
    const game = games.find((candidate) => candidate.slug === slug);
    writeJson(response, game ? gameDetail(game) : null);
    return;
  }

  if (url.pathname === '/test/security-sink/reset' && request.method === 'POST') {
    securitySinkRequests.length = 0;
    writeJson(response, { count: securitySinkRequests.length });
    return;
  }

  if (url.pathname === '/test/security-sink/count') {
    writeJson(response, { count: securitySinkRequests.length });
    return;
  }

  if (url.pathname === '/test/security-sink') {
    securitySinkRequests.push({ method: request.method, url: request.url });
    writeJson(response, { received: true });
    return;
  }

  if (url.pathname === '/test/release-scenario/reset' && request.method === 'POST') {
    resetReleaseScenario();
    writeJson(response, releaseScenario);
    return;
  }

  if (url.pathname === '/test/release-scenario' && request.method === 'POST') {
    const configured = await configureReleaseScenario(request);

    if (!configured) {
      writeJson(response, { error: 'Invalid release scenario' }, 400);
      return;
    }

    writeJson(response, releaseScenario);
    return;
  }

  if (url.pathname.startsWith('/covers/') && url.pathname.endsWith('.svg')) {
    const slug = decodeURIComponent(url.pathname.slice('/covers/'.length, -'.svg'.length));
    const game = games.find((candidate) => candidate.slug === slug);

    if (!game || !game.coverUrl) {
      writeJson(response, { error: 'Not found' }, 404);
      return;
    }

    if (slug === eagerCoverFailureSlug) {
      await delay(500);
      writeJson(response, { error: 'Cover unavailable' }, 404);
      return;
    }

    writeCover(response);
    return;
  }

  if (url.pathname.startsWith('/artifacts/') && url.pathname.endsWith('.html')) {
    const slug = decodeURIComponent(url.pathname.slice('/artifacts/'.length, -'.html'.length));
    const game = games.find((candidate) => candidate.slug === slug);

    if (!game) {
      writeJson(response, { error: 'Not found' }, 404);
      return;
    }

    await delay(releaseScenario.artifact.delayMs);

    if (releaseScenario.artifact.status !== 200) {
      writeJson(response, { error: 'Artifact unavailable' }, releaseScenario.artifact.status);
      return;
    }

    writeHtml(response, artifactHtml(game));
    return;
  }

  writeJson(response, { error: 'Not found' }, 404);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Slap-Chop Games mock API listening on http://127.0.0.1:${port}`);
});

function closeServer() {
  server.close(() => process.exit(0));
}

process.once('SIGINT', closeServer);
process.once('SIGTERM', closeServer);

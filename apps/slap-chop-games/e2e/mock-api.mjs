import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

const port = Number(process.env.SLAP_CHOP_E2E_API_PORT ?? 3107);
const fixtureProfile = process.env.SLAP_CHOP_FIXTURE_PROFILE === 'local' ? 'local' : 'test';
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

const testGames = Array.from({ length: 48 }, (_, index) => {
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

const localGames = [
  {
    coverAltText: 'A luminous spiral orbit on a midnight field',
    creatorName: 'Local fixture studio',
    description: 'Build momentum by catching a signal at the center of a shifting orbit.',
    downvoteCount: 2,
    id: 'local-game-1',
    netVotes: 42,
    publishedAt,
    slug: 'memory-rush',
    tags: ['arcade', 'reflex'],
    title: 'Memory Rush',
    upvoteCount: 44,
  },
  {
    coverAltText: 'A broken grid of warm memory fragments',
    creatorName: 'Local fixture studio',
    description: 'Recover fragments from an old machine before its memory resets.',
    downvoteCount: 3,
    id: 'local-game-2',
    netVotes: 31,
    publishedAt,
    slug: 'used-memory',
    tags: ['retro', 'puzzle'],
    title: 'Used Memory',
    upvoteCount: 34,
  },
  {
    coverAltText: 'Concentric red and cream circles forming a target',
    creatorName: 'Local fixture studio',
    description: 'A one-button timing game about landing on the quiet beat.',
    downvoteCount: 1,
    id: 'local-game-3',
    netVotes: 27,
    publishedAt,
    slug: 'orbit-tap',
    tags: ['timing', 'minimal'],
    title: 'Orbit Tap',
    upvoteCount: 28,
  },
  {
    coverAltText: 'Green pixel leaves growing across a dark square',
    creatorName: 'Local fixture studio',
    description: 'Grow a tiny procedural garden one carefully placed pixel at a time.',
    downvoteCount: 2,
    id: 'local-game-4',
    netVotes: 19,
    publishedAt,
    slug: 'pixel-garden',
    tags: ['creative', 'relaxing'],
    title: 'Pixel Garden',
    upvoteCount: 21,
  },
  {
    coverAltText: 'A sharp blue line crossing a field of black',
    creatorName: 'Local fixture studio',
    description: 'Keep a signal alive as the path accelerates and narrows.',
    downvoteCount: 4,
    id: 'local-game-5',
    netVotes: 13,
    publishedAt,
    slug: 'line-runner',
    tags: ['action', 'endless'],
    title: 'Line Runner',
    upvoteCount: 17,
  },
  {
    coverAltText: 'A violet loop folded into a compact maze',
    creatorName: 'Local fixture studio',
    description: 'Find the short route through a loop that rearranges after every move.',
    downvoteCount: 1,
    id: 'local-game-6',
    netVotes: 8,
    publishedAt,
    slug: 'pocket-loop',
    tags: ['maze', 'strategy'],
    title: 'Pocket Loop',
    upvoteCount: 9,
  },
].map((game) => ({
  ...game,
  coverUrl: `http://127.0.0.1:${port}/covers/${game.slug}.svg`,
}));

const games = fixtureProfile === 'local' ? localGames : testGames;

const localGameColors = {
  'line-runner': ['#07111f', '#76b7ff'],
  'memory-rush': ['#130d2b', '#fdc95d'],
  'orbit-tap': ['#26100d', '#ff765e'],
  'pixel-garden': ['#081c16', '#79dd9a'],
  'pocket-loop': ['#170d26', '#bd8cff'],
  'used-memory': ['#211a0d', '#e9b86e'],
};

function writeJson(response, value, status = 200) {
  response.writeHead(status, {
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(value));
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function writeCover(response, game) {
  const [background, accent] = localGameColors[game.slug] ?? ['#191915', '#f4f1e8'];
  const title = escapeHtml(game.title);

  response.writeHead(200, {
    'cache-control': 'no-store',
    'content-type': 'image/svg+xml; charset=utf-8',
  });
  response.end(
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800"><rect width="800" height="800" fill="${background}"/><circle cx="400" cy="350" r="190" fill="none" stroke="${accent}" stroke-width="36"/><circle cx="400" cy="350" r="70" fill="${accent}"/><text x="400" y="690" fill="${accent}" font-family="monospace" font-size="48" font-weight="700" text-anchor="middle">${title}</text></svg>`
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
  if (fixtureProfile === 'local') {
    const [background, accent] = localGameColors[game.slug] ?? ['#191915', '#f4f1e8'];
    const title = escapeHtml(game.title);
    const description = escapeHtml(game.description);

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${title}</title>
    <style>
      * { box-sizing: border-box; }
      html, body { height: 100%; margin: 0; }
      body { display: grid; place-items: center; overflow: hidden; background: ${background}; color: ${accent}; font-family: ui-monospace, monospace; }
      main { width: min(34rem, calc(100vw - 2rem)); text-align: center; }
      p { line-height: 1.5; opacity: 0.8; }
      button { width: min(15rem, 60vw); aspect-ratio: 1; margin-top: 1.5rem; border: 0.35rem solid ${accent}; border-radius: 50%; background: transparent; color: inherit; font: inherit; font-size: clamp(1rem, 4vw, 1.5rem); cursor: pointer; }
      button:active { background: ${accent}; color: ${background}; transform: scale(0.96); }
      output { display: block; margin-top: 1.5rem; font-size: 1.25rem; }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${description}</p>
      <button id="target" type="button">Catch signal</button>
      <output id="score">Score 0</output>
    </main>
    <script>
      let score = 0;
      const target = document.getElementById('target');
      const output = document.getElementById('score');
      target.addEventListener('click', function () {
        score += 1;
        output.textContent = 'Score ' + score;
      });
    </script>
  </body>
</html>`;
  }

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

    writeCover(response, game);
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

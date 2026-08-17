// Implements: ADR-0087 (one cross-application, capability-closed HTML sandbox runtime)

export const MAX_INTERACTIVE_HTML_BYTES = 5 * 1024 * 1024;
export const INTERACTIVE_HTML_ESCAPE_MESSAGE = 'taskmarket:interactive-html-escape';
export const INTERACTIVE_HTML_IFRAME_SANDBOX = 'allow-scripts';
export const INTERACTIVE_HTML_IFRAME_ALLOW = '';
export const INTERACTIVE_HTML_REFERRER_POLICY = 'no-referrer';
// Curated games may import the reviewed Three.js module tree. The path is intentional: it does
// not grant access to the rest of the jsDelivr CDN or enable fetch/XHR/WebSocket egress.
export const INTERACTIVE_HTML_THREE_JS_CDN_SOURCE = 'https://cdn.jsdelivr.net/npm/three@0.185.1/';

export const INTERACTIVE_HTML_CSP_DIRECTIVES = [
  "default-src 'none'",
  `script-src 'unsafe-inline' ${INTERACTIVE_HTML_THREE_JS_CDN_SOURCE}`,
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data: blob:',
  'media-src data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "manifest-src 'none'",
] as const;

// The document loaded by the application iframe is trusted runtime code, not the submitted game.
// Its blob-only frame policy permits the reconstructed game document and blocks data/HTTP(S)
// navigation before a request is made. The submitted game remains in an opaque-origin iframe.
export const INTERACTIVE_HTML_WRAPPER_CSP_DIRECTIVES = [
  "default-src 'none'",
  // Blob documents inherit this policy, so the reviewed module source must be present here too.
  `script-src 'unsafe-inline' ${INTERACTIVE_HTML_THREE_JS_CDN_SOURCE}`,
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data: blob:',
  'media-src data: blob:',
  "connect-src 'none'",
  'frame-src blob:',
  "worker-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "manifest-src 'none'",
] as const;

export type HtmlArtifactIdentity = {
  fileName: string;
  mimeType: string;
};

export type SizedHtmlArtifact = HtmlArtifactIdentity & {
  sizeBytes: number;
};

export type InteractiveHtmlEligibilityReason = 'unsupported-artifact' | 'declared-size-exceeded';

export type InteractiveHtmlEligibility =
  | {
      kind: 'eligible';
      maxBytes: number;
    }
  | {
      kind: 'ineligible';
      maxBytes: number;
      reason: InteractiveHtmlEligibilityReason;
    };

export type SignedHtmlUrlSource = {
  getUrl: () => string | null | Promise<string | null>;
  refreshUrl?: () => string | null | Promise<string | null>;
};

export type Sha256Digest = (bytes: Uint8Array) => Promise<ArrayBuffer>;

export type PinnedHtmlIntegrityOutcome =
  | {
      actualSha256: string;
      expectedSha256: string;
      kind: 'verified';
    }
  | {
      actualSha256: string;
      expectedSha256: string;
      kind: 'integrity-error';
    }
  | {
      kind: 'runtime-error';
      message: string;
    };

export type InteractiveHtmlRuntimeOutcome =
  | {
      kind: 'loading';
    }
  | {
      byteLength: number;
      document: string;
      kind: 'ready';
      sha256: string | null;
    }
  | {
      kind: 'ineligible';
      maxBytes: number;
      reason: InteractiveHtmlEligibilityReason;
    }
  | {
      byteLength: number | null;
      kind: 'fetched-size-exceeded';
      maxBytes: number;
    }
  | {
      kind: 'fetch-error';
      message: string;
      status: number | null;
    }
  | {
      actualSha256: string;
      expectedSha256: string;
      kind: 'integrity-error';
    }
  | {
      kind: 'runtime-error';
      message: string;
    };

export type InteractiveHtmlRuntimeOptions = {
  artifact: SizedHtmlArtifact;
  digest?: Sha256Digest;
  expectedSha256?: string | null;
  fetch?: typeof globalThis.fetch;
  maxBytes?: number;
  refresh?: boolean;
  signal?: AbortSignal;
  source: SignedHtmlUrlSource;
};

type InteractiveHtmlBodyOutcome =
  | {
      byteLength: number;
      bytes: Uint8Array;
      html: string;
      kind: 'body-ready';
    }
  | Extract<InteractiveHtmlRuntimeOutcome, { kind: 'fetched-size-exceeded' | 'fetch-error' }>;

export const INTERACTIVE_HTML_LOADING_OUTCOME = { kind: 'loading' } as const;

export function buildInteractiveHtmlCsp(): string {
  return INTERACTIVE_HTML_CSP_DIRECTIVES.join('; ');
}

export const INTERACTIVE_HTML_CSP = buildInteractiveHtmlCsp();

export function buildInteractiveHtmlWrapperCsp(): string {
  return INTERACTIVE_HTML_WRAPPER_CSP_DIRECTIVES.join('; ');
}

export const INTERACTIVE_HTML_WRAPPER_CSP = buildInteractiveHtmlWrapperCsp();

export function isInteractiveHtmlArtifact(artifact: HtmlArtifactIdentity): boolean {
  const normalizedMimeType = artifact.mimeType.split(';', 1)[0]?.trim().toLowerCase();
  return normalizedMimeType === 'text/html' || /\.html?$/i.test(artifact.fileName.trim());
}

export function getInteractiveHtmlEligibility(
  artifact: SizedHtmlArtifact,
  maxBytes = MAX_INTERACTIVE_HTML_BYTES
): InteractiveHtmlEligibility {
  if (!isInteractiveHtmlArtifact(artifact)) {
    return { kind: 'ineligible', maxBytes, reason: 'unsupported-artifact' };
  }

  if (
    !Number.isSafeInteger(artifact.sizeBytes) ||
    artifact.sizeBytes < 0 ||
    artifact.sizeBytes > maxBytes
  ) {
    return { kind: 'ineligible', maxBytes, reason: 'declared-size-exceeded' };
  }

  return { kind: 'eligible', maxBytes };
}

export function canRenderInteractiveHtml(artifact: SizedHtmlArtifact): boolean {
  return getInteractiveHtmlEligibility(artifact).kind === 'eligible';
}

export function isInteractiveHtmlParentMessage(data: unknown): boolean {
  return data === INTERACTIVE_HTML_ESCAPE_MESSAGE;
}

// Returns a trusted wrapper document. The submitted HTML is never interpolated into executable
// wrapper source: the wrapper reconstructs UTF-8 bytes into a nested, separately sandboxed blob.
// This extra boundary keeps a game from self-navigating the app-owned iframe around its own CSP.
export function buildSandboxedHtmlDocument(rawHtml: string): string {
  if (typeof DOMParser === 'undefined') {
    throw new Error('DOMParser is unavailable in this runtime.');
  }

  return buildInteractiveHtmlWrapper(buildSandboxedGameDocument(rawHtml));
}

function buildSandboxedGameDocument(rawHtml: string): string {
  const parsed = new DOMParser().parseFromString(rawHtml, 'text/html');
  const policy = parsed.createElement('meta');
  policy.setAttribute('http-equiv', 'Content-Security-Policy');
  policy.setAttribute('content', INTERACTIVE_HTML_CSP);
  parsed.head.prepend(policy);

  // Keyboard events do not cross an iframe boundary. Relay only Escape so the
  // parent can restore its bounded surface. The parent must validate both the
  // exact message and the sending Window before taking its reversible action.
  const escapeBridge = parsed.createElement('script');
  escapeBridge.dataset.taskmarketBridge = 'escape';
  escapeBridge.textContent = `window.addEventListener('keydown',function(event){if(event.key==='Escape'){window.parent.postMessage('${INTERACTIVE_HTML_ESCAPE_MESSAGE}','*');}},true);`;
  parsed.body.append(escapeBridge);

  return `<!doctype html>\n${parsed.documentElement.outerHTML}`;
}

function buildInteractiveHtmlWrapper(gameDocument: string): string {
  const encodedGameDocument = encodeUtf8ToBase64(gameDocument);
  const escapeMessage = JSON.stringify(INTERACTIVE_HTML_ESCAPE_MESSAGE);
  const nestedSandbox = JSON.stringify(INTERACTIVE_HTML_IFRAME_SANDBOX);
  const nestedAllow = JSON.stringify(INTERACTIVE_HTML_IFRAME_ALLOW);
  const nestedReferrerPolicy = JSON.stringify(INTERACTIVE_HTML_REFERRER_POLICY);

  return `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Security-Policy" content="${INTERACTIVE_HTML_WRAPPER_CSP}">
    <style>
      html, body { height: 100%; margin: 0; overflow: hidden; }
      iframe[data-taskmarket-game-frame] { border: 0; display: block; height: 100%; width: 100%; }
    </style>
  </head>
  <body>
    <script data-taskmarket-game type="application/octet-stream">${encodedGameDocument}</script>
    <script data-taskmarket-wrapper="game-jail">
      (function () {
        const encodedDocument = document.querySelector('script[data-taskmarket-game]')?.textContent;
        if (!encodedDocument) return;

        const binaryDocument = atob(encodedDocument);
        const documentBytes = new Uint8Array(binaryDocument.length);
        for (let index = 0; index < binaryDocument.length; index += 1) {
          documentBytes[index] = binaryDocument.charCodeAt(index);
        }
        const gameUrl = URL.createObjectURL(
          new Blob([documentBytes], { type: 'text/html;charset=utf-8' })
        );

        const gameFrame = document.createElement('iframe');
        gameFrame.dataset.taskmarketGameFrame = 'true';
        gameFrame.setAttribute('allow', ${nestedAllow});
        gameFrame.setAttribute('referrerpolicy', ${nestedReferrerPolicy});
        gameFrame.setAttribute('sandbox', ${nestedSandbox});
        gameFrame.setAttribute('title', 'Game content');
        gameFrame.src = gameUrl;
        window.addEventListener('pagehide', function () {
          URL.revokeObjectURL(gameUrl);
        }, { once: true });

        window.addEventListener('message', function (event) {
          if (event.source === gameFrame.contentWindow && event.data === ${escapeMessage}) {
            window.parent.postMessage(${escapeMessage}, '*');
          }
        });

        document.body.append(gameFrame);
      }());
    </script>
  </body>
</html>`;
}

function encodeUtf8ToBase64(value: string): string {
  if (typeof btoa !== 'function') {
    throw new Error('Base64 encoding is unavailable in this runtime.');
  }

  const bytes = new TextEncoder().encode(value);
  const chunks: string[] = [];
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }

  return btoa(chunks.join(''));
}

export async function resolveSignedHtmlUrl(
  source: SignedHtmlUrlSource,
  refresh = false
): Promise<string | null> {
  const resolve = refresh ? (source.refreshUrl ?? source.getUrl) : source.getUrl;
  const url = await resolve();
  return typeof url === 'string' && url.trim().length > 0 ? url : null;
}

export async function sha256Hex(
  bytes: Uint8Array,
  digest: Sha256Digest = browserSha256Digest
): Promise<string> {
  const hash = new Uint8Array(await digest(bytes));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyPinnedHtmlSha256(
  bytes: Uint8Array,
  expectedSha256: string,
  digest: Sha256Digest = browserSha256Digest
): Promise<PinnedHtmlIntegrityOutcome> {
  const normalizedExpected = expectedSha256.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalizedExpected)) {
    return {
      kind: 'runtime-error',
      message: 'Expected SHA-256 digest must be 64 hexadecimal characters.',
    };
  }

  try {
    const actualSha256 = await sha256Hex(bytes, digest);
    return actualSha256 === normalizedExpected
      ? { actualSha256, expectedSha256: normalizedExpected, kind: 'verified' }
      : { actualSha256, expectedSha256: normalizedExpected, kind: 'integrity-error' };
  } catch (error) {
    return { kind: 'runtime-error', message: errorMessage(error, 'Failed to hash HTML artifact.') };
  }
}

export async function loadInteractiveHtmlRuntime(
  options: InteractiveHtmlRuntimeOptions
): Promise<InteractiveHtmlRuntimeOutcome> {
  const maxBytes = options.maxBytes ?? MAX_INTERACTIVE_HTML_BYTES;
  const eligibility = getInteractiveHtmlEligibility(options.artifact, maxBytes);
  if (eligibility.kind === 'ineligible') {
    return eligibility;
  }

  let url: string | null;
  try {
    url = await resolveSignedHtmlUrl(options.source, options.refresh);
  } catch (error) {
    return {
      kind: 'fetch-error',
      message: errorMessage(error, 'Failed to refresh the HTML artifact URL.'),
      status: null,
    };
  }

  if (!url) {
    return {
      kind: 'fetch-error',
      message: 'The HTML artifact URL is unavailable.',
      status: null,
    };
  }

  const fetchHtml = options.fetch ?? globalThis.fetch;
  if (typeof fetchHtml !== 'function') {
    return { kind: 'runtime-error', message: 'Fetch is unavailable in this runtime.' };
  }

  let response: Response;
  try {
    response = await fetchHtml(url, { signal: options.signal });
  } catch (error) {
    return {
      kind: 'fetch-error',
      message: errorMessage(error, 'Failed to load HTML artifact.'),
      status: null,
    };
  }

  let body: InteractiveHtmlBodyOutcome;
  try {
    body = await readInteractiveHtmlResponse(response, maxBytes);
  } catch (error) {
    return {
      kind: 'fetch-error',
      message: errorMessage(error, 'Failed to read HTML artifact.'),
      status: null,
    };
  }

  if (body.kind !== 'body-ready') {
    return body;
  }

  let sha256: string | null = null;
  if (options.expectedSha256) {
    const integrity = await verifyPinnedHtmlSha256(
      body.bytes,
      options.expectedSha256,
      options.digest
    );
    if (integrity.kind === 'runtime-error') {
      return integrity;
    }
    if (integrity.kind === 'integrity-error') {
      return integrity;
    }
    sha256 = integrity.actualSha256;
  }

  try {
    return {
      byteLength: body.byteLength,
      document: buildSandboxedHtmlDocument(body.html),
      kind: 'ready',
      sha256,
    };
  } catch (error) {
    return {
      kind: 'runtime-error',
      message: errorMessage(error, 'Failed to construct sandboxed HTML document.'),
    };
  }
}

async function browserSha256Digest(bytes: Uint8Array): Promise<ArrayBuffer> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is unavailable in this runtime.');
  }

  // Copy into an ArrayBuffer-backed view before calling Web Crypto. TypeScript 6
  // distinguishes a Uint8Array backed by SharedArrayBuffer even though the runtime
  // API accepts its bytes; a copy also keeps hashing isolated from caller mutation.
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  return globalThis.crypto.subtle.digest('SHA-256', input);
}

async function readInteractiveHtmlResponse(
  response: Response,
  maxBytes: number
): Promise<InteractiveHtmlBodyOutcome> {
  if (!response.ok) {
    return {
      kind: 'fetch-error',
      message: `Request failed (${response.status})`,
      status: response.status,
    };
  }

  const contentLength = declaredContentLength(response);
  if (contentLength !== null && contentLength > maxBytes) {
    return { byteLength: contentLength, kind: 'fetched-size-exceeded', maxBytes };
  }

  const bytes = response.body
    ? await readResponseStream(response.body, maxBytes)
    : await readResponseBody(response, maxBytes);

  if (bytes === null) {
    return { byteLength: null, kind: 'fetched-size-exceeded', maxBytes };
  }

  return {
    byteLength: bytes.byteLength,
    bytes,
    html: new TextDecoder().decode(bytes),
    kind: 'body-ready',
  };
}

function declaredContentLength(response: Response): number | null {
  const header = response.headers?.get('content-length');
  if (!header) {
    return null;
  }

  const length = Number(header);
  return Number.isSafeInteger(length) && length >= 0 ? length : null;
}

async function readResponseStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number
): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let finished = false;

  while (!finished) {
    const { done, value } = await reader.read();
    if (done) {
      finished = true;
      continue;
    }
    if (!value) {
      continue;
    }

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }

  return joinChunks(chunks, totalBytes);
}

async function readResponseBody(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const responseWithOptionalBuffer = response as Response & {
    arrayBuffer?: () => Promise<ArrayBuffer>;
  };

  if (typeof responseWithOptionalBuffer.arrayBuffer === 'function') {
    const bytes = new Uint8Array(await responseWithOptionalBuffer.arrayBuffer());
    return bytes.byteLength > maxBytes ? null : bytes;
  }

  const html = await response.text();
  const bytes = new TextEncoder().encode(html);
  return bytes.byteLength > maxBytes ? null : bytes;
}

function joinChunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

// Verifies: ADR-0087 (the shared sandbox fails closed before executing untrusted HTML)

import { describe, expect, it, vi } from 'vitest';

import {
  INTERACTIVE_HTML_CSP,
  INTERACTIVE_HTML_ESCAPE_MESSAGE,
  INTERACTIVE_HTML_IFRAME_ALLOW,
  INTERACTIVE_HTML_IFRAME_SANDBOX,
  INTERACTIVE_HTML_LOADING_OUTCOME,
  INTERACTIVE_HTML_REFERRER_POLICY,
  INTERACTIVE_HTML_WRAPPER_CSP,
  MAX_INTERACTIVE_HTML_BYTES,
  buildSandboxedHtmlDocument,
  canRenderInteractiveHtml,
  getInteractiveHtmlEligibility,
  isInteractiveHtmlArtifact,
  isInteractiveHtmlParentMessage,
  loadInteractiveHtmlRuntime,
  resolveSignedHtmlUrl,
  sha256Hex,
  verifyPinnedHtmlSha256,
  type Sha256Digest,
} from '../src/index';

const htmlArtifact = {
  fileName: 'calculator.html',
  mimeType: 'text/html',
  sizeBytes: 1024,
};

function responseWithText(
  html: string,
  options: { contentLength?: number; ok?: boolean; status?: number } = {}
): Response {
  const bytes = new TextEncoder().encode(html);
  return {
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    body: null,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-length' && options.contentLength !== undefined
          ? String(options.contentLength)
          : null,
    },
    ok: options.ok ?? true,
    status: options.status ?? 200,
    text: async () => html,
  } as unknown as Response;
}

function digestFor(hex: string): Sha256Digest {
  return async () => {
    const bytes = Uint8Array.from(
      hex.match(/.{1,2}/g)?.map((pair) => Number.parseInt(pair, 16)) ?? []
    );
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  };
}

function parseWrapperDocument(rendered: string): Document {
  return new DOMParser().parseFromString(rendered, 'text/html');
}

function parseNestedGameDocument(rendered: string): Document {
  const wrapper = parseWrapperDocument(rendered);
  const encodedDocument = wrapper.querySelector('script[data-taskmarket-game]')?.textContent;

  if (!encodedDocument) {
    throw new Error('Expected nested game document bytes.');
  }

  const binaryDocument = atob(encodedDocument);
  const bytes = new Uint8Array(binaryDocument.length);
  for (let index = 0; index < binaryDocument.length; index += 1) {
    bytes[index] = binaryDocument.charCodeAt(index);
  }

  return new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'text/html');
}

describe('interactive HTML eligibility', () => {
  it('recognizes normalized HTML MIME types and extension fallbacks', () => {
    expect(
      isInteractiveHtmlArtifact({
        fileName: 'submission.bin',
        mimeType: ' Text/HTML; Charset=UTF-8 ',
      })
    ).toBe(true);
    expect(
      isInteractiveHtmlArtifact({
        fileName: 'calculator.HTM',
        mimeType: 'application/octet-stream',
      })
    ).toBe(true);
    expect(
      isInteractiveHtmlArtifact({
        fileName: 'calculator.html.txt',
        mimeType: 'text/plain',
      })
    ).toBe(false);
  });

  it('fails closed for unsupported, invalid-size, and oversized artifacts', () => {
    expect(canRenderInteractiveHtml(htmlArtifact)).toBe(true);
    expect(
      getInteractiveHtmlEligibility({ ...htmlArtifact, sizeBytes: MAX_INTERACTIVE_HTML_BYTES + 1 })
    ).toMatchObject({ kind: 'ineligible', reason: 'declared-size-exceeded' });
    expect(getInteractiveHtmlEligibility({ ...htmlArtifact, sizeBytes: -1 })).toMatchObject({
      kind: 'ineligible',
      reason: 'declared-size-exceeded',
    });
    expect(
      getInteractiveHtmlEligibility({
        fileName: 'notes.txt',
        mimeType: 'text/plain',
        sizeBytes: 16,
      })
    ).toMatchObject({ kind: 'ineligible', reason: 'unsupported-artifact' });
  });
});

describe('sandbox document policy', () => {
  it('places the restrictive policy before submitted scripts and preserves submitted content', () => {
    const rendered = buildSandboxedHtmlDocument(`<!doctype html>
      <html>
        <head>
          <style>button { color: rebeccapurple; }</style>
          <script>window.calculatorLoaded = true;</script>
        </head>
        <body><button id="equals">Calculate</button></body>
      </html>`);
    const wrapper = parseWrapperDocument(rendered);
    const parsed = parseNestedGameDocument(rendered);
    const policy = parsed.head.querySelector('meta[http-equiv="Content-Security-Policy"]');
    const script = parsed.head.querySelector('script');

    expect(
      wrapper.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')
    ).toBe(INTERACTIVE_HTML_WRAPPER_CSP);
    expect(wrapper.querySelector('script[data-taskmarket-game]')?.textContent).not.toContain(
      'window.calculatorLoaded = true'
    );
    expect(policy?.getAttribute('content')).toBe(INTERACTIVE_HTML_CSP);
    expect(policy?.nextElementSibling?.tagName).toBe('STYLE');
    expect(script?.textContent).toContain('window.calculatorLoaded = true');
    expect(parsed.body.querySelector('#equals')?.textContent).toBe('Calculate');
  });

  it('keeps forms, network connections, nested frames, workers, objects, and base URLs blocked', () => {
    const rendered = buildSandboxedHtmlDocument('<p>Safe frame</p>');
    const wrapper = parseWrapperDocument(rendered);
    const parsed = parseNestedGameDocument(rendered);
    const policy =
      parsed.head
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute('content') ?? '';

    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).toContain("child-src 'none'");
    expect(policy).toContain("worker-src 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).not.toContain('unsafe-eval');
    expect(
      wrapper.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')
    ).toContain('frame-src blob:');
  });

  it('uses an allow-scripts-only iframe contract with no storage, popup, or navigation privileges', () => {
    expect(INTERACTIVE_HTML_IFRAME_SANDBOX).toBe('allow-scripts');
    expect(INTERACTIVE_HTML_IFRAME_SANDBOX).not.toContain('allow-same-origin');
    expect(INTERACTIVE_HTML_IFRAME_SANDBOX).not.toContain('allow-popups');
    expect(INTERACTIVE_HTML_IFRAME_SANDBOX).not.toContain('allow-top-navigation');
    expect(INTERACTIVE_HTML_IFRAME_ALLOW).toBe('');
    expect(INTERACTIVE_HTML_REFERRER_POLICY).toBe('no-referrer');
  });

  it('does not grant external script or other network capability', () => {
    expect(INTERACTIVE_HTML_CSP).toContain("script-src 'unsafe-inline'");
    expect(INTERACTIVE_HTML_CSP).toContain("connect-src 'none'");
    expect(INTERACTIVE_HTML_CSP).not.toMatch(/https?:|wss?:/);
  });

  it('injects only the data-free Escape bridge and rejects all other parent messages', () => {
    const rendered = buildSandboxedHtmlDocument(
      '<button id="submitted-control">Submitted control</button>'
    );
    const wrapper = parseWrapperDocument(rendered);
    const parsed = parseNestedGameDocument(rendered);
    const bridge = parsed.body.querySelector('script[data-taskmarket-bridge="escape"]');
    const relay = wrapper.querySelector('script[data-taskmarket-wrapper="game-jail"]');

    expect(bridge?.previousElementSibling?.id).toBe('submitted-control');
    expect(bridge?.textContent).toContain("event.key==='Escape'");
    expect(bridge?.textContent).toContain(INTERACTIVE_HTML_ESCAPE_MESSAGE);
    expect(relay?.textContent).toContain('event.source === gameFrame.contentWindow');
    expect(relay?.textContent).toContain(INTERACTIVE_HTML_ESCAPE_MESSAGE);
    expect(relay?.textContent).toContain('new Blob([documentBytes]');
    expect(relay?.textContent).toContain('URL.createObjectURL');
    expect(relay?.textContent).toContain('gameFrame.src = gameUrl');
    expect(relay?.textContent).toContain('URL.revokeObjectURL(gameUrl)');
    expect(relay?.textContent).not.toContain('data:text/html;base64,');
    expect(isInteractiveHtmlParentMessage(INTERACTIVE_HTML_ESCAPE_MESSAGE)).toBe(true);
    expect(isInteractiveHtmlParentMessage({ type: INTERACTIVE_HTML_ESCAPE_MESSAGE })).toBe(false);
  });

  it('base64-encodes submitted bytes before adding them to the trusted wrapper', () => {
    const submittedHtml = '<main id="raw-game">Raw game</main></script><img src="/egress">';
    const rendered = buildSandboxedHtmlDocument(submittedHtml);
    const wrapper = parseWrapperDocument(rendered);

    expect(wrapper.querySelector('script[data-taskmarket-game]')?.textContent).toMatch(
      /^[A-Za-z0-9+/=]+$/
    );
    expect(rendered).not.toContain(submittedHtml);
    expect(parseNestedGameDocument(rendered).querySelector('#raw-game')?.textContent).toBe(
      'Raw game'
    );
  });
});

describe('signed URLs and integrity', () => {
  it('uses the explicit refresh hook only when a caller asks for a refreshed URL', async () => {
    const getUrl = vi.fn().mockResolvedValue('https://files.example.com/current.html');
    const refreshUrl = vi.fn().mockResolvedValue('https://files.example.com/fresh.html');
    const source = { getUrl, refreshUrl };

    await expect(resolveSignedHtmlUrl(source)).resolves.toBe(
      'https://files.example.com/current.html'
    );
    await expect(resolveSignedHtmlUrl(source, true)).resolves.toBe(
      'https://files.example.com/fresh.html'
    );
    expect(getUrl).toHaveBeenCalledOnce();
    expect(refreshUrl).toHaveBeenCalledOnce();
  });

  it('computes the standard SHA-256 digest and verifies pinned bytes', async () => {
    const bytes = new TextEncoder().encode('abc');
    const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

    await expect(sha256Hex(bytes)).resolves.toBe(expected);
    await expect(verifyPinnedHtmlSha256(bytes, expected)).resolves.toEqual({
      actualSha256: expected,
      expectedSha256: expected,
      kind: 'verified',
    });
  });
});

describe('interactive HTML runtime outcomes', () => {
  it('exposes a typed loading state before an adapter starts work', () => {
    expect(INTERACTIVE_HTML_LOADING_OUTCOME).toEqual({ kind: 'loading' });
  });

  it('returns a ready document after a bounded fetch', async () => {
    const fetchHtml = vi.fn().mockResolvedValue(responseWithText('<p>Ready</p>'));

    const outcome = await loadInteractiveHtmlRuntime({
      artifact: htmlArtifact,
      fetch: fetchHtml,
      source: { getUrl: () => 'https://files.example.com/game.html' },
    });

    expect(outcome).toMatchObject({ byteLength: 12, kind: 'ready', sha256: null });
    expect(fetchHtml).toHaveBeenCalledWith('https://files.example.com/game.html', {
      signal: undefined,
    });
  });

  it('returns a typed fetched-size failure before reading an oversized response body', async () => {
    const fetchHtml = vi
      .fn()
      .mockResolvedValue(
        responseWithText('<p>ignored</p>', { contentLength: MAX_INTERACTIVE_HTML_BYTES + 1 })
      );

    const outcome = await loadInteractiveHtmlRuntime({
      artifact: htmlArtifact,
      fetch: fetchHtml,
      source: { getUrl: () => 'https://files.example.com/game.html' },
    });

    expect(outcome).toEqual({
      byteLength: MAX_INTERACTIVE_HTML_BYTES + 1,
      kind: 'fetched-size-exceeded',
      maxBytes: MAX_INTERACTIVE_HTML_BYTES,
    });
  });

  it('cancels a streamed body as soon as it crosses the byte limit', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const read = vi
      .fn()
      .mockResolvedValueOnce({ done: false, value: new Uint8Array(MAX_INTERACTIVE_HTML_BYTES) })
      .mockResolvedValueOnce({ done: false, value: new Uint8Array(1) });
    const response = {
      body: { getReader: () => ({ cancel, read }) },
      headers: { get: () => null },
      ok: true,
      status: 200,
    } as unknown as Response;

    const outcome = await loadInteractiveHtmlRuntime({
      artifact: htmlArtifact,
      fetch: vi.fn().mockResolvedValue(response),
      source: { getUrl: () => 'https://files.example.com/game.html' },
    });

    expect(outcome).toMatchObject({ kind: 'fetched-size-exceeded' });
    expect(read).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('returns typed fetch, integrity, and runtime failures without rendering HTML', async () => {
    const failedFetch = await loadInteractiveHtmlRuntime({
      artifact: htmlArtifact,
      fetch: vi.fn().mockResolvedValue(responseWithText('', { ok: false, status: 403 })),
      source: { getUrl: () => 'https://files.example.com/expired.html' },
    });
    expect(failedFetch).toEqual({
      kind: 'fetch-error',
      message: 'Request failed (403)',
      status: 403,
    });

    const integrityFailure = await loadInteractiveHtmlRuntime({
      artifact: htmlArtifact,
      digest: digestFor('b'.repeat(64)),
      expectedSha256: 'a'.repeat(64),
      fetch: vi.fn().mockResolvedValue(responseWithText('<p>tampered</p>')),
      source: { getUrl: () => 'https://files.example.com/tampered.html' },
    });
    expect(integrityFailure).toEqual({
      actualSha256: 'b'.repeat(64),
      expectedSha256: 'a'.repeat(64),
      kind: 'integrity-error',
    });

    const runtimeFailure = await loadInteractiveHtmlRuntime({
      artifact: htmlArtifact,
      digest: async () => {
        throw new Error('Web Crypto is unavailable.');
      },
      expectedSha256: 'a'.repeat(64),
      fetch: vi.fn().mockResolvedValue(responseWithText('<p>no crypto</p>')),
      source: { getUrl: () => 'https://files.example.com/no-crypto.html' },
    });
    expect(runtimeFailure).toEqual({
      kind: 'runtime-error',
      message: 'Web Crypto is unavailable.',
    });
  });
});

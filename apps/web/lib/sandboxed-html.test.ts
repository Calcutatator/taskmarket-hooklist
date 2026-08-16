import { describe, expect, it } from 'vitest';

import {
  INTERACTIVE_HTML_CSP,
  INTERACTIVE_HTML_ESCAPE_MESSAGE,
  INTERACTIVE_HTML_WRAPPER_CSP,
  MAX_INTERACTIVE_HTML_BYTES,
  buildSandboxedHtmlDocument,
  canRenderInteractiveHtml,
  isInteractiveHtmlArtifact,
} from './sandboxed-html';

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

describe('isInteractiveHtmlArtifact', () => {
  it('recognizes normalized HTML MIME types', () => {
    expect(
      isInteractiveHtmlArtifact({
        fileName: 'submission.bin',
        mimeType: ' Text/HTML; Charset=UTF-8 ',
      })
    ).toBe(true);
  });

  it.each(['calculator.html', 'calculator.HTM'])(
    'recognizes %s when upload MIME detection falls back to octet-stream',
    (fileName) => {
      expect(
        isInteractiveHtmlArtifact({
          fileName,
          mimeType: 'application/octet-stream',
        })
      ).toBe(true);
    }
  );

  it('does not treat a filename containing .html as an HTML artifact', () => {
    expect(
      isInteractiveHtmlArtifact({
        fileName: 'calculator.html.txt',
        mimeType: 'text/plain',
      })
    ).toBe(false);
  });
});

describe('canRenderInteractiveHtml', () => {
  it('allows an HTML artifact at the exact 5 MiB limit', () => {
    expect(
      canRenderInteractiveHtml({
        fileName: 'calculator.html',
        mimeType: 'text/html',
        sizeBytes: MAX_INTERACTIVE_HTML_BYTES,
      })
    ).toBe(true);
  });

  it('rejects an HTML artifact one byte over the 5 MiB limit', () => {
    expect(
      canRenderInteractiveHtml({
        fileName: 'calculator.html',
        mimeType: 'text/html',
        sizeBytes: MAX_INTERACTIVE_HTML_BYTES + 1,
      })
    ).toBe(false);
  });
});

describe('buildSandboxedHtmlDocument', () => {
  it('places policy before submitted scripts inside a base64-isolated nested game document', () => {
    const rawHtml = `<!doctype html>
      <html>
        <head>
          <style>button { color: rebeccapurple; }</style>
          <script>window.calculatorLoaded = true;</script>
        </head>
        <body><button id="equals">Calculate</button></body>
      </html>`;

    const rendered = buildSandboxedHtmlDocument(rawHtml);
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

  it('blocks network, nested navigation, form, worker, object, and base-url capabilities', () => {
    const rendered = buildSandboxedHtmlDocument('<p>Safe frame</p>');
    const wrapper = parseWrapperDocument(rendered);
    const parsed = parseNestedGameDocument(rendered);
    const policy =
      parsed.head
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute('content') ?? '';
    const wrapperPolicy =
      wrapper
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute('content') ?? '';

    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("script-src 'unsafe-inline'");
    expect(policy).toContain("style-src 'unsafe-inline'");
    expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).toContain("worker-src 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).not.toContain('unsafe-eval');
    expect(wrapperPolicy).toContain('frame-src blob:');
  });

  it('does not grant external scripts to submitted HTML', () => {
    const rendered = buildSandboxedHtmlDocument(`
      <script src="https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"></script>
      <script src="https://unpkg.com/three@0.160.0/build/three.module.js"></script>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
      <script src="https://scripts.example.com/untrusted.js"></script>
    `);

    expect(parseNestedGameDocument(rendered).querySelectorAll('script[src]')).toHaveLength(4);
    expect(INTERACTIVE_HTML_CSP).toContain("script-src 'unsafe-inline'");
    expect(INTERACTIVE_HTML_CSP).not.toMatch(/https?:|wss?:/);
  });

  it('keeps the Taskmarket policy first when submitted HTML contains its own policy', () => {
    const rendered = buildSandboxedHtmlDocument(`
      <html>
        <head>
          <meta http-equiv="Content-Security-Policy" content="default-src *">
        </head>
        <body>Submitted policy</body>
      </html>
    `);
    const parsed = parseNestedGameDocument(rendered);
    const policies = parsed.head.querySelectorAll('meta[http-equiv="Content-Security-Policy"]');

    expect(policies).toHaveLength(2);
    expect(policies[0]?.getAttribute('content')).toContain("default-src 'none'");
    expect(policies[1]?.getAttribute('content')).toBe('default-src *');
  });

  it('relays only the fixed Escape bridge from the nested game frame', () => {
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
  });
});

import { describe, expect, it } from 'vitest';

import {
  INTERACTIVE_HTML_ESCAPE_MESSAGE,
  MAX_INTERACTIVE_HTML_BYTES,
  buildSandboxedHtmlDocument,
  canRenderInteractiveHtml,
  isInteractiveHtmlArtifact,
} from './sandboxed-html';

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
  it('places Taskmarket policy before submitted scripts and preserves the application', () => {
    const rawHtml = `<!doctype html>
      <html>
        <head>
          <style>button { color: rebeccapurple; }</style>
          <script>window.calculatorLoaded = true;</script>
        </head>
        <body><button id="equals">Calculate</button></body>
      </html>`;

    const rendered = buildSandboxedHtmlDocument(rawHtml);
    const parsed = new DOMParser().parseFromString(rendered, 'text/html');
    const policy = parsed.head.querySelector('meta[http-equiv="Content-Security-Policy"]');
    const script = parsed.head.querySelector('script');

    expect(policy).not.toBeNull();
    expect(policy?.nextElementSibling?.tagName).toBe('STYLE');
    expect(script?.textContent).toContain('window.calculatorLoaded = true');
    expect(parsed.body.querySelector('#equals')?.textContent).toBe('Calculate');
  });

  it('blocks network, embedding, form, worker, object, and base-url capabilities', () => {
    const rendered = buildSandboxedHtmlDocument('<p>Safe frame</p>');
    const parsed = new DOMParser().parseFromString(rendered, 'text/html');
    const policy =
      parsed.head
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
  });

  it('allows scripts from approved public CDNs without trusting arbitrary script origins', () => {
    const rendered = buildSandboxedHtmlDocument(`
      <script src="https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"></script>
      <script src="https://unpkg.com/three@0.160.0/build/three.module.js"></script>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
      <script src="https://scripts.example.com/untrusted.js"></script>
    `);
    const parsed = new DOMParser().parseFromString(rendered, 'text/html');
    const policy =
      parsed.head
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute('content') ?? '';

    expect(policy).toContain(
      "script-src 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com"
    );
    expect(policy).not.toContain('https://scripts.example.com');
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
    const parsed = new DOMParser().parseFromString(rendered, 'text/html');
    const policies = parsed.head.querySelectorAll('meta[http-equiv="Content-Security-Policy"]');

    expect(policies).toHaveLength(2);
    expect(policies[0]?.getAttribute('content')).toContain("default-src 'none'");
    expect(policies[1]?.getAttribute('content')).toBe('default-src *');
  });

  it('adds a fixed Escape bridge after submitted content without expanding permissions', () => {
    const rendered = buildSandboxedHtmlDocument(
      '<button id="submitted-control">Submitted control</button>'
    );
    const parsed = new DOMParser().parseFromString(rendered, 'text/html');
    const bridge = parsed.body.querySelector('script[data-taskmarket-bridge="escape"]');

    expect(bridge?.previousElementSibling?.id).toBe('submitted-control');
    expect(bridge?.textContent).toContain("event.key==='Escape'");
    expect(bridge?.textContent).toContain(INTERACTIVE_HTML_ESCAPE_MESSAGE);
  });
});

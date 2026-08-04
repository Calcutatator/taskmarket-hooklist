import type { ArtifactResponse } from '@taskmarket/shared';

type HtmlArtifactIdentity = Pick<ArtifactResponse, 'fileName' | 'mimeType'>;
type SizedHtmlArtifact = HtmlArtifactIdentity & Pick<ArtifactResponse, 'sizeBytes'>;

export const MAX_INTERACTIVE_HTML_BYTES = 5 * 1024 * 1024;
export const INTERACTIVE_HTML_ESCAPE_MESSAGE = 'taskmarket:interactive-html-escape';

const INTERACTIVE_HTML_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
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
].join('; ');

export function isInteractiveHtmlArtifact(artifact: HtmlArtifactIdentity): boolean {
  const normalizedMimeType = artifact.mimeType.split(';', 1)[0]?.trim().toLowerCase();
  return normalizedMimeType === 'text/html' || /\.html?$/i.test(artifact.fileName.trim());
}

export function canRenderInteractiveHtml(artifact: SizedHtmlArtifact): boolean {
  return isInteractiveHtmlArtifact(artifact) && artifact.sizeBytes <= MAX_INTERACTIVE_HTML_BYTES;
}

export function buildSandboxedHtmlDocument(rawHtml: string): string {
  const parsed = new DOMParser().parseFromString(rawHtml, 'text/html');
  const policy = parsed.createElement('meta');
  policy.setAttribute('http-equiv', 'Content-Security-Policy');
  policy.setAttribute('content', INTERACTIVE_HTML_CSP);
  parsed.head.prepend(policy);

  // Keyboard events do not cross an iframe boundary. Relay only Escape so the
  // parent viewer can restore its bounded surface even after the user has focused
  // an interactive control inside the sandbox. The parent validates the sending
  // Window and deliberately limits this spoofable, data-free signal to a reversible
  // layout change; it can never close the viewer or expand iframe permissions.
  const escapeBridge = parsed.createElement('script');
  escapeBridge.dataset.taskmarketBridge = 'escape';
  escapeBridge.textContent = `window.addEventListener('keydown',function(event){if(event.key==='Escape'){window.parent.postMessage('${INTERACTIVE_HTML_ESCAPE_MESSAGE}','*');}},true);`;
  parsed.body.append(escapeBridge);

  return `<!doctype html>\n${parsed.documentElement.outerHTML}`;
}

import type { ArtifactResponse } from '@taskmarket/shared';

type HtmlArtifactIdentity = Pick<ArtifactResponse, 'fileName' | 'mimeType'>;
type SizedHtmlArtifact = HtmlArtifactIdentity & Pick<ArtifactResponse, 'sizeBytes'>;

export const MAX_INTERACTIVE_HTML_BYTES = 5 * 1024 * 1024;

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
  return `<!doctype html>\n${parsed.documentElement.outerHTML}`;
}

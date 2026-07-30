'use client';

import type { ArtifactResponse } from '@taskmarket/shared';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  MAX_INTERACTIVE_HTML_BYTES,
  buildSandboxedHtmlDocument,
  canRenderInteractiveHtml,
} from '@/lib/sandboxed-html';

export const UNTRUSTED_HTML_WARNING_TEXT =
  'Untrusted interactive HTML. Do not enter passwords, approve wallet requests, or provide sensitive information.';

// Shared by every presentation of the warning (inline note, collapsible chip) so the
// wording and accessible name stay identical everywhere it appears.
export function UntrustedHtmlWarningNote({ className }: { className?: string }) {
  return (
    <div
      aria-label="Untrusted HTML warning"
      className={
        className ??
        'flex items-start gap-2 rounded-xl border border-border/60 bg-muted/32 p-3 text-xs text-muted-foreground'
      }
      role="note"
    >
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-foreground" />
      <p>{UNTRUSTED_HTML_WARNING_TEXT}</p>
    </div>
  );
}

// A small persistent affordance for surfaces (the mobile artifact sheet) where the
// full three-line warning would consume too much of the viewport by default. The
// warning stays reachable -- tapping the chip reveals the exact same note.
export function UntrustedHtmlWarningChip() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="grid gap-2">
      <button
        aria-expanded={expanded}
        className="flex w-fit items-center gap-1.5 rounded-full border border-border/60 bg-muted/32 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <AlertTriangle aria-hidden="true" className="size-3.5 text-foreground" />
        Untrusted HTML
      </button>
      {expanded ? <UntrustedHtmlWarningNote /> : null}
    </div>
  );
}

type InteractiveHtmlPreviewClassNames = {
  container?: string;
  error?: string;
  iframe?: string;
  message?: string;
};

const DEFAULT_CLASS_NAMES: Required<InteractiveHtmlPreviewClassNames> = {
  container: 'grid gap-3',
  error:
    'grid gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive',
  iframe: 'h-[65vh] w-full rounded-xl border border-border/60 bg-background/52',
  message: 'rounded-xl border border-border/60 bg-background/52 p-4 text-sm text-muted-foreground',
};

// Renders an interactive HTML artifact by fetching its body, enforcing the declared-
// and fetched-size limits, and sandboxing it in an iframe. This is the single
// implementation for every surface that embeds untrusted HTML inline (the per-
// artifact preview dialog/sheet and the submission gallery) so the trust boundary
// (sandbox, CSP, referrer policy, allow list) is defined in exactly one place.
export function InteractiveHtmlPreview({
  artifact,
  classNames,
  previewUrl,
  showWarning = true,
}: {
  artifact: ArtifactResponse;
  classNames?: InteractiveHtmlPreviewClassNames;
  previewUrl: string;
  showWarning?: boolean;
}) {
  const [sandboxDocument, setSandboxDocument] = useState<string | null>(null);
  const [bodyExceedsLimit, setBodyExceedsLimit] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const declaredSizeExceedsLimit = !canRenderInteractiveHtml(artifact);
  const resolved = { ...DEFAULT_CLASS_NAMES, ...classNames };

  useEffect(() => {
    if (declaredSizeExceedsLimit) {
      setSandboxDocument(null);
      setBodyExceedsLimit(false);
      setFetchError(null);
      return;
    }

    const controller = new AbortController();
    setSandboxDocument(null);
    setBodyExceedsLimit(false);
    setFetchError(null);

    fetch(previewUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Request failed (${response.status})`);
        }
        return response.text();
      })
      .then((html) => {
        if (new Blob([html]).size > MAX_INTERACTIVE_HTML_BYTES) {
          setBodyExceedsLimit(true);
          return;
        }
        setSandboxDocument(buildSandboxedHtmlDocument(html));
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        setFetchError(error instanceof Error ? error.message : 'Failed to load HTML preview');
      });

    return () => controller.abort();
  }, [attempt, declaredSizeExceedsLimit, previewUrl]);

  if (declaredSizeExceedsLimit || bodyExceedsLimit) {
    return (
      <div className={resolved.message}>
        This HTML file exceeds the 5 MB interactive preview limit.
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className={resolved.error}>
        <p>Failed to load HTML preview: {fetchError}</p>
        <Button onClick={() => setAttempt((value) => value + 1)} size="sm" type="button">
          Retry
        </Button>
      </div>
    );
  }

  if (!sandboxDocument) {
    return <div className={resolved.message}>Loading interactive HTML preview...</div>;
  }

  return (
    <div className={resolved.container}>
      {showWarning ? <UntrustedHtmlWarningNote /> : null}
      <iframe
        allow=""
        className={resolved.iframe}
        referrerPolicy="no-referrer"
        sandbox="allow-scripts"
        srcDoc={sandboxDocument}
        title={`Interactive preview of ${artifact.fileName}`}
      />
    </div>
  );
}

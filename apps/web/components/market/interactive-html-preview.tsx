'use client';

import type { ArtifactResponse } from '@taskmarket/shared';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  INTERACTIVE_HTML_IFRAME_ALLOW,
  INTERACTIVE_HTML_IFRAME_SANDBOX,
  INTERACTIVE_HTML_LOADING_OUTCOME,
  INTERACTIVE_HTML_REFERRER_POLICY,
  isInteractiveHtmlParentMessage,
  loadInteractiveHtmlRuntime,
  type InteractiveHtmlRuntimeOutcome,
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
        className="flex min-h-11 w-fit items-center gap-1.5 rounded-full border border-border/60 bg-muted/32 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground md:min-h-0"
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
  onEscape,
  onRetry,
  previewUrl,
  showWarning = true,
}: {
  artifact: ArtifactResponse;
  classNames?: InteractiveHtmlPreviewClassNames;
  onEscape?: () => void;
  onRetry?: () => Promise<unknown> | unknown;
  previewUrl: string;
  showWarning?: boolean;
}) {
  const [runtimeOutcome, setRuntimeOutcome] = useState<InteractiveHtmlRuntimeOutcome>(
    INTERACTIVE_HTML_LOADING_OUTCOME
  );
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const htmlArtifact = useMemo(
    () => ({
      fileName: artifact.fileName,
      mimeType: artifact.mimeType,
      sizeBytes: artifact.sizeBytes,
    }),
    [artifact.fileName, artifact.mimeType, artifact.sizeBytes]
  );
  const resolved = { ...DEFAULT_CLASS_NAMES, ...classNames };

  useEffect(() => {
    if (!onEscape) {
      return;
    }

    const handleMessage = (event: MessageEvent<unknown>) => {
      if (
        isInteractiveHtmlParentMessage(event.data) &&
        event.source === iframeRef.current?.contentWindow
      ) {
        onEscape();
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onEscape]);

  useEffect(() => {
    const controller = new AbortController();
    setRuntimeOutcome(INTERACTIVE_HTML_LOADING_OUTCOME);

    void loadInteractiveHtmlRuntime({
      artifact: htmlArtifact,
      expectedSha256: artifact.sha256Hash,
      signal: controller.signal,
      source: { getUrl: () => previewUrl },
    }).then((outcome) => {
      if (!controller.signal.aborted) {
        setRuntimeOutcome(outcome);
      }
    });

    return () => controller.abort();
  }, [artifact.sha256Hash, attempt, htmlArtifact, previewUrl]);

  async function retry() {
    setRetrying(true);
    try {
      await onRetry?.();
    } finally {
      setAttempt((value) => value + 1);
      setRetrying(false);
    }
  }

  if (runtimeOutcome.kind === 'ineligible' || runtimeOutcome.kind === 'fetched-size-exceeded') {
    return (
      <div className={resolved.message} role="status">
        This HTML file exceeds the 5 MB interactive preview limit.
      </div>
    );
  }

  if (runtimeOutcome.kind === 'fetch-error') {
    return (
      <div className={resolved.error} role="alert">
        <p>Failed to load HTML preview: {runtimeOutcome.message}. The link may have expired.</p>
        <Button disabled={retrying} onClick={() => void retry()} size="sm" type="button">
          {retrying ? 'Refreshing…' : 'Retry'}
        </Button>
      </div>
    );
  }

  if (runtimeOutcome.kind === 'integrity-error') {
    return (
      <div className={resolved.error} role="alert">
        <p>Failed to verify HTML preview integrity. The file was not executed.</p>
        <Button disabled={retrying} onClick={() => void retry()} size="sm" type="button">
          {retrying ? 'Refreshing…' : 'Retry'}
        </Button>
      </div>
    );
  }

  if (runtimeOutcome.kind === 'runtime-error') {
    return (
      <div className={resolved.error} role="alert">
        <p>Failed to prepare HTML preview: {runtimeOutcome.message}.</p>
        <Button disabled={retrying} onClick={() => void retry()} size="sm" type="button">
          {retrying ? 'Refreshing…' : 'Retry'}
        </Button>
      </div>
    );
  }

  if (runtimeOutcome.kind !== 'ready') {
    return (
      <div className={resolved.message} role="status">
        Loading interactive HTML preview…
      </div>
    );
  }

  return (
    <div className={resolved.container}>
      {showWarning ? <UntrustedHtmlWarningNote /> : null}
      <iframe
        allow={INTERACTIVE_HTML_IFRAME_ALLOW}
        className={resolved.iframe}
        ref={iframeRef}
        referrerPolicy={INTERACTIVE_HTML_REFERRER_POLICY}
        sandbox={INTERACTIVE_HTML_IFRAME_SANDBOX}
        srcDoc={runtimeOutcome.document}
        title={`Interactive preview of ${artifact.fileName}`}
      />
    </div>
  );
}

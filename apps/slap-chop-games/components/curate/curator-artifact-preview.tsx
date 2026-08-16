'use client';

import type { GameCurationArtifact } from '@taskmarket/shared';
import {
  INTERACTIVE_HTML_IFRAME_ALLOW,
  INTERACTIVE_HTML_IFRAME_SANDBOX,
  INTERACTIVE_HTML_LOADING_OUTCOME,
  INTERACTIVE_HTML_REFERRER_POLICY,
  loadInteractiveHtmlRuntime,
  type InteractiveHtmlRuntimeOutcome,
} from '@taskmarket/html-sandbox';
import { useEffect, useState } from 'react';

type CuratorArtifactPreviewProps = {
  artifact: GameCurationArtifact | null;
  onOutcomeChange: (outcome: InteractiveHtmlRuntimeOutcome | null) => void;
};

function previewFailureCopy(
  outcome: Exclude<InteractiveHtmlRuntimeOutcome, { kind: 'loading' | 'ready' }>
): { detail: string; title: string } {
  if (outcome.kind === 'ineligible') {
    return {
      detail:
        outcome.reason === 'declared-size-exceeded'
          ? 'The declared file size exceeds the production game limit, so it was not opened.'
          : 'This file is not an HTML game under the production runtime policy.',
      title: 'Preview blocked',
    };
  }

  if (outcome.kind === 'fetched-size-exceeded') {
    return {
      detail: 'The delivered file exceeded the production game limit, so it was not opened.',
      title: 'Preview blocked',
    };
  }

  if (outcome.kind === 'integrity-error') {
    return {
      detail: 'The delivered file did not match the selected artifact hash, so it was not opened.',
      title: 'Preview integrity check failed',
    };
  }

  if (outcome.kind === 'fetch-error') {
    return {
      detail:
        outcome.status === 401 || outcome.status === 403 || outcome.status === 404
          ? 'The signed preview link is no longer valid. Resolve the task again for a fresh link.'
          : 'Taskmarket could not load this artifact into the production sandbox.',
      title:
        outcome.status === 401 || outcome.status === 403 || outcome.status === 404
          ? 'Preview link expired'
          : 'Preview unavailable',
    };
  }

  return { detail: outcome.message, title: 'Preview could not be prepared' };
}

function canRetryPreview(
  outcome: Exclude<InteractiveHtmlRuntimeOutcome, { kind: 'loading' | 'ready' }>
): boolean {
  if (outcome.kind === 'fetch-error') {
    return outcome.status !== 401 && outcome.status !== 403 && outcome.status !== 404;
  }

  return outcome.kind === 'runtime-error';
}

// Implements: ADR-0087. The curator reviews the exact selected artifact through the same shared
// runtime policy as the public player: bounded fetch, pinned SHA-256, CSP document, and closed
// iframe capabilities. It never renders fetched HTML outside that runtime.
export function CuratorArtifactPreview({
  artifact,
  onOutcomeChange,
}: Readonly<CuratorArtifactPreviewProps>) {
  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<InteractiveHtmlRuntimeOutcome | null>(null);

  useEffect(() => {
    if (!artifact) {
      setOutcome(null);
      onOutcomeChange(null);
      return;
    }

    const controller = new AbortController();
    let active = true;

    setOutcome(INTERACTIVE_HTML_LOADING_OUTCOME);
    onOutcomeChange(INTERACTIVE_HTML_LOADING_OUTCOME);

    void loadInteractiveHtmlRuntime({
      artifact: {
        fileName: artifact.fileName,
        mimeType: artifact.mimeType,
        sizeBytes: artifact.sizeBytes,
      },
      expectedSha256: artifact.sha256Hash,
      signal: controller.signal,
      source: {
        getUrl: () => artifact.previewUrl,
      },
    }).then((nextOutcome) => {
      if (!active) return;
      setOutcome(nextOutcome);
      onOutcomeChange(nextOutcome);
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [artifact, attempt, onOutcomeChange]);

  if (!artifact) {
    return (
      <section
        aria-labelledby="curator-preview-title"
        className="border border-catalog-border bg-catalog-surface p-4"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-catalog-muted">
          Production preview
        </p>
        <h2 className="mt-2 text-lg font-semibold tracking-tight" id="curator-preview-title">
          Select an artifact to review
        </h2>
        <p className="mt-2 text-sm leading-6 text-catalog-muted">
          Only an accepted playable HTML artifact can be reviewed and pinned for the catalog.
        </p>
      </section>
    );
  }

  const previewId = `curator-preview-${artifact.id}`;

  return (
    <section
      aria-labelledby="curator-preview-title"
      className="border border-catalog-border bg-catalog-surface"
    >
      <header className="border-b border-catalog-border px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-catalog-muted">
          Production preview
        </p>
        <h2 className="mt-1 text-lg font-semibold tracking-tight" id="curator-preview-title">
          Review the pinned artifact
        </h2>
        <p className="mt-1 text-sm leading-6 text-catalog-muted">
          This is the same closed-capability sandbox used by players. The Taskmarket HTML remains in
          its source record and cannot be edited here.
        </p>
      </header>

      <div
        aria-live="polite"
        className="relative aspect-video min-h-56 bg-catalog-canvas"
        id={previewId}
      >
        {outcome?.kind === 'ready' ? (
          <iframe
            allow={INTERACTIVE_HTML_IFRAME_ALLOW}
            className="absolute inset-0 h-full w-full border-0 bg-catalog-canvas"
            referrerPolicy={INTERACTIVE_HTML_REFERRER_POLICY}
            sandbox={INTERACTIVE_HTML_IFRAME_SANDBOX}
            srcDoc={outcome.document}
            title={`Curator preview of ${artifact.fileName}`}
          />
        ) : outcome?.kind === 'loading' ? (
          <PreviewPanel
            detail="Checking the selected artifact hash before it opens."
            title="Loading preview"
          />
        ) : outcome ? (
          <PreviewPanel
            detail={previewFailureCopy(outcome).detail}
            retry={canRetryPreview(outcome) ? () => setAttempt((value) => value + 1) : undefined}
            title={previewFailureCopy(outcome).title}
          />
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-catalog-border px-4 py-3">
        <p className="min-w-0 truncate font-mono text-xs text-catalog-muted">
          SHA-256 {artifact.sha256Hash}
        </p>
        {outcome?.kind === 'ready' ? (
          <span className="shrink-0 text-xs font-semibold text-catalog-ink">Verified</span>
        ) : null}
      </div>
    </section>
  );
}

function PreviewPanel({
  detail,
  retry,
  title,
}: Readonly<{
  detail: string;
  retry?: () => void;
  title: string;
}>) {
  return (
    <div className="grid h-full place-items-center p-4">
      <div className="max-w-sm border border-catalog-border bg-catalog-surface p-4">
        <h3 className="text-base font-semibold tracking-tight">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-catalog-muted">{detail}</p>
        {retry ? (
          <button
            className="mt-4 min-h-10 border border-catalog-border px-3 text-sm font-semibold text-catalog-ink hover:bg-catalog-canvas"
            onClick={retry}
            type="button"
          >
            Retry preview
          </button>
        ) : null}
      </div>
    </div>
  );
}

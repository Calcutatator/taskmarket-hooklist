import type { GameDetailResponse } from '@taskmarket/shared';
import {
  INTERACTIVE_HTML_IFRAME_ALLOW,
  INTERACTIVE_HTML_IFRAME_SANDBOX,
  INTERACTIVE_HTML_REFERRER_POLICY,
  type InteractiveHtmlRuntimeOutcome,
} from '@taskmarket/html-sandbox';
import type { ReactNode, RefObject } from 'react';

import type { GameDetailReadFailure } from '@/lib/game-detail-api';

type GamePlayerSurfaceProps = {
  controls?: ReactNode;
  detailFailure?: GameDetailReadFailure;
  game: GameDetailResponse | null;
  iframeRef?: RefObject<HTMLIFrameElement | null>;
  onBack: () => void;
  onRetry: () => void;
  retrying: boolean;
  runtimeOutcome: InteractiveHtmlRuntimeOutcome;
};

function getScoreLabel(netVotes: number): string {
  return netVotes > 0 ? `+${netVotes}` : String(netVotes);
}

function getDetailFailureCopy(failure: GameDetailReadFailure): {
  detail: string;
  retryLabel: string;
  title: string;
} {
  if (failure.kind === 'not_found') {
    return {
      detail: 'This game is no longer available in the catalog.',
      retryLabel: 'Check again',
      title: 'Game unavailable',
    };
  }

  if (failure.kind === 'invalid_response') {
    return {
      detail: 'The catalog returned an unreadable game record.',
      retryLabel: 'Check again',
      title: 'Game details unavailable',
    };
  }

  return {
    detail: 'Taskmarket could not provide this game right now.',
    retryLabel: 'Retry',
    title: 'Game details unavailable',
  };
}

function RuntimeStatusPanel({
  outcome,
  onRetry,
  retrying,
}: Readonly<{
  onRetry: () => void;
  outcome: InteractiveHtmlRuntimeOutcome;
  retrying: boolean;
}>) {
  if (outcome.kind === 'ready') {
    return null;
  }

  if (outcome.kind === 'loading') {
    return (
      <div aria-live="polite" className="player-panel" role="status">
        <p className="player-panel-kicker">Preparing</p>
        <h2 className="player-panel-title">Loading game</h2>
        <p className="player-panel-copy">Checking the reviewed game file before it opens.</p>
      </div>
    );
  }

  if (outcome.kind === 'ineligible') {
    const oversized = outcome.reason === 'declared-size-exceeded';

    return (
      <div aria-live="polite" className="player-panel" role="status">
        <p className="player-panel-kicker">Unavailable</p>
        <h2 className="player-panel-title">
          {oversized ? 'Game exceeds the play limit' : 'Game file is not supported'}
        </h2>
        <p className="player-panel-copy">
          {oversized
            ? `This reviewed file is larger than the ${formatBytes(outcome.maxBytes)} play limit.`
            : 'This catalog entry does not point to an HTML game file.'}
        </p>
      </div>
    );
  }

  if (outcome.kind === 'fetched-size-exceeded') {
    return (
      <div aria-live="polite" className="player-panel" role="status">
        <p className="player-panel-kicker">Unavailable</p>
        <h2 className="player-panel-title">Delivered game exceeds the play limit</h2>
        <p className="player-panel-copy">
          The downloaded file is larger than the {formatBytes(outcome.maxBytes)} play limit and was
          not opened.
        </p>
      </div>
    );
  }

  const copy = getRuntimeFailureCopy(outcome);

  return (
    <div aria-live="assertive" className="player-panel" role="alert">
      <p className="player-panel-kicker">Unavailable</p>
      <h2 className="player-panel-title">{copy.title}</h2>
      <p className="player-panel-copy">{copy.detail}</p>
      {copy.canRetry ? (
        <button
          className="player-action player-action-secondary"
          disabled={retrying}
          onClick={onRetry}
          type="button"
        >
          {retrying ? 'Refreshing game link' : copy.retryLabel}
        </button>
      ) : null}
    </div>
  );
}

function getRuntimeFailureCopy(
  outcome: Exclude<
    InteractiveHtmlRuntimeOutcome,
    { kind: 'fetched-size-exceeded' | 'ineligible' | 'loading' | 'ready' }
  >
): {
  canRetry: boolean;
  detail: string;
  retryLabel: string;
  title: string;
} {
  if (outcome.kind === 'integrity-error') {
    return {
      canRetry: true,
      detail: 'The delivered file did not match the curator-pinned hash. It was not opened.',
      retryLabel: 'Refresh game link',
      title: 'Game integrity check failed',
    };
  }

  if (outcome.kind === 'fetch-error') {
    const expired = outcome.status === 401 || outcome.status === 403 || outcome.status === 404;

    return {
      canRetry: true,
      detail: expired
        ? 'The short-lived game link expired before the file could load.'
        : `The game file could not load${outcome.status ? ` (${outcome.status})` : ''}.`,
      retryLabel: 'Refresh game link',
      title: expired ? 'Game link expired' : 'Game file unavailable',
    };
  }

  return {
    canRetry: true,
    detail: outcome.message,
    retryLabel: 'Retry game',
    title: 'Game could not be prepared',
  };
}

function formatBytes(value: number): string {
  if (value === 5 * 1024 * 1024) {
    return '5 MB';
  }

  return `${Math.ceil(value / (1024 * 1024))} MB`;
}

// Implements: ADR-0087. The only executable surface is the shared, closed-capability iframe.
export function GamePlayerSurface({
  controls,
  detailFailure,
  game,
  iframeRef,
  onBack,
  onRetry,
  retrying,
  runtimeOutcome,
}: Readonly<GamePlayerSurfaceProps>) {
  const title = game?.title ?? 'Game';
  const status = detailFailure
    ? getDetailFailureCopy(detailFailure).title
    : runtimeOutcome.kind === 'ready'
      ? 'Playing'
      : runtimeOutcome.kind === 'loading'
        ? 'Loading'
        : 'Unavailable';

  return (
    <section
      aria-describedby="game-player-status"
      aria-label={`${title} game player`}
      className="relative isolate h-[100dvh] overflow-hidden bg-catalog-canvas text-catalog-ink"
    >
      {runtimeOutcome.kind === 'ready' ? (
        <iframe
          allow={INTERACTIVE_HTML_IFRAME_ALLOW}
          className="absolute inset-0 z-0 h-full w-full border-0 bg-catalog-canvas"
          ref={iframeRef}
          referrerPolicy={INTERACTIVE_HTML_REFERRER_POLICY}
          sandbox={INTERACTIVE_HTML_IFRAME_SANDBOX}
          srcDoc={runtimeOutcome.document}
          title={`${title} game`}
        />
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex min-h-11 items-start bg-catalog-canvas/94">
        <header
          aria-label="Game controls"
          className="pointer-events-auto grid min-h-11 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center border-b border-catalog-border"
        >
          <button
            aria-label="Back to catalog"
            className="player-back-control"
            onClick={onBack}
            type="button"
          >
            Back
          </button>
          <div className="min-w-0 px-3">
            <h1 className="truncate text-sm font-semibold tracking-tight text-catalog-ink">
              {title}
            </h1>
          </div>
          <div className="flex h-full items-center gap-2 border-l border-catalog-border px-3 text-xs">
            {game ? (
              <span className="font-mono text-catalog-muted">{getScoreLabel(game.netVotes)}</span>
            ) : null}
            {controls}
            <span className="text-catalog-muted" id="game-player-status" role="status">
              {status}
            </span>
          </div>
        </header>
      </div>

      {detailFailure ? (
        <div className="absolute inset-0 z-[1] grid place-items-center p-4 pt-16">
          <DetailFailurePanel failure={detailFailure} onRetry={onRetry} retrying={retrying} />
        </div>
      ) : runtimeOutcome.kind !== 'ready' ? (
        <div className="absolute inset-0 z-[1] grid place-items-center p-4 pt-16">
          <RuntimeStatusPanel onRetry={onRetry} outcome={runtimeOutcome} retrying={retrying} />
        </div>
      ) : null}
    </section>
  );
}

function DetailFailurePanel({
  failure,
  onRetry,
  retrying,
}: Readonly<{
  failure: GameDetailReadFailure;
  onRetry: () => void;
  retrying: boolean;
}>) {
  const copy = getDetailFailureCopy(failure);

  return (
    <div aria-live="assertive" className="player-panel" role="alert">
      <p className="player-panel-kicker">Unavailable</p>
      <h2 className="player-panel-title">{copy.title}</h2>
      <p className="player-panel-copy">{copy.detail}</p>
      <button
        className="player-action player-action-secondary"
        disabled={retrying}
        onClick={onRetry}
        type="button"
      >
        {retrying ? 'Checking game' : copy.retryLabel}
      </button>
    </div>
  );
}

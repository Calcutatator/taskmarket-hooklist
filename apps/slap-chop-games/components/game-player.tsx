'use client';

import type { GameDetailResponse } from '@taskmarket/shared';
import {
  INTERACTIVE_HTML_LOADING_OUTCOME,
  isInteractiveHtmlParentMessage,
  loadInteractiveHtmlRuntime,
  type InteractiveHtmlRuntimeOutcome,
} from '@taskmarket/html-sandbox';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import { GamePlayerSurface } from '@/components/game-player-surface';
import { refreshGameDetail, type GameDetailReadFailure } from '@/lib/game-detail-api';
import { claimGameLaunch, discardGameLaunch, prepareGameReturn } from '@/lib/game-navigation';
import { reportPlayerTelemetry, type PlayerTelemetryPayload } from '@/lib/player-telemetry';

type RuntimeRequest = {
  game: GameDetailResponse;
  refresh: boolean;
  sequence: number;
};

type GamePlayerProps = {
  controls?: ReactNode;
  initialFailure?: GameDetailReadFailure;
  initialGame: GameDetailResponse | null;
  slug: string;
};

function artifactFetchFailureReason(
  status: number | null
): 'artifact_fetch_http_4xx' | 'artifact_fetch_http_5xx' | 'artifact_fetch_network' {
  if (status !== null && status >= 400 && status < 500) {
    return 'artifact_fetch_http_4xx';
  }

  if (status !== null && status >= 500 && status < 600) {
    return 'artifact_fetch_http_5xx';
  }

  return 'artifact_fetch_network';
}

function playerRuntimeTelemetry(
  outcome: InteractiveHtmlRuntimeOutcome,
  refresh: boolean
): PlayerTelemetryPayload | null {
  if (outcome.kind === 'integrity-error') {
    return { event: 'integrity_failure', reason: 'sha256_mismatch' };
  }

  if (outcome.kind === 'fetch-error') {
    return {
      event: refresh ? 'artifact_refresh_failure' : 'runtime_failure',
      reason: artifactFetchFailureReason(outcome.status),
    };
  }

  if (outcome.kind === 'fetched-size-exceeded') {
    return { event: 'runtime_failure', reason: 'fetched_size_exceeded' };
  }

  if (outcome.kind === 'ineligible') {
    return {
      event: 'runtime_failure',
      reason:
        outcome.reason === 'declared-size-exceeded'
          ? 'declared_size_exceeded'
          : 'unsupported_artifact',
    };
  }

  if (outcome.kind === 'runtime-error') {
    return { event: 'runtime_failure', reason: 'runtime_error' };
  }

  return null;
}

function playerDetailRefreshTelemetry(failure: GameDetailReadFailure): PlayerTelemetryPayload {
  if (failure.kind === 'invalid_response') {
    return { event: 'artifact_refresh_failure', reason: 'catalog_invalid_response' };
  }

  if (failure.kind === 'not_found') {
    return { event: 'artifact_refresh_failure', reason: 'catalog_not_found' };
  }

  return { event: 'artifact_refresh_failure', reason: 'catalog_unavailable' };
}

// Implements: ADR-0087. This adapter owns delivery refresh and presentation only; the shared
// runtime owns artifact eligibility, bounded bytes, hash verification, CSP, and iframe policy.
export function GamePlayer({
  controls,
  initialFailure,
  initialGame,
  slug,
}: Readonly<GamePlayerProps>) {
  const router = useRouter();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const hasInitializedProps = useRef(false);
  const [game, setGame] = useState(initialGame);
  const [detailFailure, setDetailFailure] = useState<GameDetailReadFailure | undefined>(
    initialFailure
  );
  const [runtimeOutcome, setRuntimeOutcome] = useState<InteractiveHtmlRuntimeOutcome>(
    INTERACTIVE_HTML_LOADING_OUTCOME
  );
  const [retrying, setRetrying] = useState(false);
  const [runtimeRequest, setRuntimeRequest] = useState<RuntimeRequest | null>(
    initialGame ? { game: initialGame, refresh: false, sequence: 0 } : null
  );

  useEffect(() => {
    if (!hasInitializedProps.current) {
      hasInitializedProps.current = true;
      return;
    }

    setGame(initialGame);
    setDetailFailure(initialFailure);
    setRetrying(false);
    setRuntimeOutcome(INTERACTIVE_HTML_LOADING_OUTCOME);
    setRuntimeRequest(initialGame ? { game: initialGame, refresh: false, sequence: 0 } : null);
  }, [initialFailure, initialGame, slug]);

  useEffect(() => {
    claimGameLaunch(slug);

    return () => discardGameLaunch(slug);
  }, [slug]);

  const returnToCatalog = useCallback(() => {
    const target = prepareGameReturn(slug);

    if (target.kind === 'history') {
      window.history.back();
      return;
    }

    router.replace(target.href as Route);
  }, [router, slug]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (
        isInteractiveHtmlParentMessage(event.data) &&
        event.source === iframeRef.current?.contentWindow
      ) {
        returnToCatalog();
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [returnToCatalog]);

  useEffect(() => {
    if (!runtimeRequest) {
      return;
    }

    const controller = new AbortController();
    let active = true;
    const sourceGame = runtimeRequest.game;

    setRuntimeOutcome(INTERACTIVE_HTML_LOADING_OUTCOME);

    void loadInteractiveHtmlRuntime({
      artifact: {
        fileName: `${sourceGame.slug}.html`,
        mimeType: sourceGame.source.artifactMimeType,
        sizeBytes: sourceGame.source.artifactSizeBytes,
      },
      expectedSha256: sourceGame.source.artifactSha256Hash,
      refresh: runtimeRequest.refresh,
      signal: controller.signal,
      source: {
        getUrl: () => sourceGame.artifactUrl,
        refreshUrl: async () => {
          const refreshed = await refreshGameDetail(sourceGame.slug, controller.signal);

          if (!refreshed.ok) {
            if (active) {
              setDetailFailure(refreshed.failure);
            }
            return null;
          }

          if (active) {
            setGame(refreshed.game);
            setDetailFailure(undefined);
          }

          // Keep this runtime attempt bound to the source pin it started with. If the catalog
          // record changed during link refresh, its fetched bytes fail the original pin check
          // instead of executing a newly selected artifact without a fresh route load.
          return refreshed.game.artifactUrl;
        },
      },
    }).then((outcome) => {
      if (active) {
        const telemetry = playerRuntimeTelemetry(outcome, runtimeRequest.refresh);
        if (telemetry) {
          reportPlayerTelemetry(telemetry);
        }
        setRuntimeOutcome(outcome);
        setRetrying(false);
      }
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [runtimeRequest]);

  const retry = useCallback(async () => {
    if (retrying) {
      return;
    }

    setRetrying(true);

    if (game) {
      setDetailFailure(undefined);
      setRuntimeRequest((request) => ({
        game: request?.game ?? game,
        refresh: true,
        sequence: (request?.sequence ?? 0) + 1,
      }));
      return;
    }

    const refreshed = await refreshGameDetail(slug);

    if (!refreshed.ok) {
      reportPlayerTelemetry(playerDetailRefreshTelemetry(refreshed.failure));
      setDetailFailure(refreshed.failure);
      setRetrying(false);
      return;
    }

    setGame(refreshed.game);
    setDetailFailure(undefined);
    setRuntimeRequest((request) => ({
      game: refreshed.game,
      refresh: false,
      sequence: (request?.sequence ?? 0) + 1,
    }));
  }, [game, retrying, slug]);

  return (
    <GamePlayerSurface
      controls={controls}
      detailFailure={detailFailure}
      game={game}
      iframeRef={iframeRef}
      onBack={returnToCatalog}
      onRetry={() => void retry()}
      retrying={retrying}
      runtimeOutcome={runtimeOutcome}
    />
  );
}

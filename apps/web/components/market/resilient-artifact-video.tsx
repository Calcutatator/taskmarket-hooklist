'use client';

import type { ArtifactResponse } from '@taskmarket/shared';
import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

import { Button } from '@/components/ui/button';
import { useArtifactPreviewUrl } from '@/components/market/use-artifact-preview-url';

type NativeVideoProps = Omit<ComponentPropsWithoutRef<'video'>, 'children' | 'src'>;

export type ResilientArtifactVideoProps = NativeVideoProps & {
  artifact: ArtifactResponse;
  // Feed surfaces can keep their layout shell mounted without exposing a media URL
  // until the video is close enough to be useful to the viewer.
  deferSourceUntilNearViewport?: boolean;
  fallback?: ReactNode;
  fetchMissingPreview?: boolean;
  initialPreviewExpiresAt?: string | null;
  initialPreviewUrl?: string | null;
  onPreviewUrlChange?: (previewUrl: string | null) => void;
  playbackActive?: boolean;
  showOpenAction?: boolean;
};

type PendingRestore = {
  currentTime: number;
  resume: boolean;
};

type RecoveryPhase = 'idle' | 'refreshing' | 'retrying';

function readableCurrentTime(video: HTMLVideoElement) {
  return Number.isFinite(video.currentTime) ? video.currentTime : 0;
}

export const ResilientArtifactVideo = forwardRef<HTMLVideoElement, ResilientArtifactVideoProps>(
  function ResilientArtifactVideo(
    {
      artifact,
      deferSourceUntilNearViewport = false,
      fallback,
      fetchMissingPreview = true,
      initialPreviewExpiresAt,
      initialPreviewUrl,
      onEnded,
      onError,
      onLoadedMetadata,
      onPause,
      onPlay,
      onPreviewUrlChange,
      playbackActive = true,
      showOpenAction = true,
      ...videoProps
    },
    forwardedRef
  ) {
    const { ensurePreviewUrl, error, loading, previewUrl } = useArtifactPreviewUrl(
      artifact.taskId,
      artifact,
      initialPreviewUrl === undefined
        ? undefined
        : { expiresAt: initialPreviewExpiresAt, url: initialPreviewUrl }
    );
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const playingRef = useRef(false);
    const recoveryPhaseRef = useRef<RecoveryPhase>('idle');
    const retrySourceActiveRef = useRef(false);
    const retrySrcRef = useRef<string | null>(null);
    const pendingRestoreRef = useRef<PendingRestore | null>(null);
    const playbackActiveRef = useRef(playbackActive);
    playbackActiveRef.current = playbackActive;
    const [activeSrc, setActiveSrc] = useState(previewUrl);
    const [failed, setFailed] = useState(false);
    const [sourceEnabled, setSourceEnabled] = useState(!deferSourceUntilNearViewport);

    const setVideoRef = useCallback(
      (video: HTMLVideoElement | null) => {
        videoRef.current = video;
        if (typeof forwardedRef === 'function') {
          forwardedRef(video);
        } else if (forwardedRef) {
          forwardedRef.current = video;
        }
      },
      [forwardedRef]
    );

    useEffect(() => {
      playingRef.current = false;
      recoveryPhaseRef.current = 'idle';
      retrySourceActiveRef.current = false;
      retrySrcRef.current = null;
      pendingRestoreRef.current = null;
      setFailed(false);
      setActiveSrc(previewUrl);
      setSourceEnabled(!deferSourceUntilNearViewport);
    }, [artifact.id, deferSourceUntilNearViewport]);

    useEffect(() => {
      if (sourceEnabled || !deferSourceUntilNearViewport) {
        return;
      }

      const video = videoRef.current;
      if (!video || typeof IntersectionObserver === 'undefined') {
        return;
      }

      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            setSourceEnabled(true);
          }
        },
        { rootMargin: '200px' }
      );
      observer.observe(video);
      return () => observer.disconnect();
    }, [deferSourceUntilNearViewport, sourceEnabled]);

    useEffect(() => {
      if (playbackActive) {
        return;
      }

      if (pendingRestoreRef.current) {
        pendingRestoreRef.current.resume = false;
      }
      const video = videoRef.current;
      if (video && !video.paused) {
        video.pause();
      }
    }, [playbackActive]);

    useEffect(() => {
      onPreviewUrlChange?.(previewUrl ?? activeSrc);
    }, [activeSrc, onPreviewUrlChange, previewUrl]);

    useEffect(() => {
      if (!sourceEnabled || !fetchMissingPreview || failed || previewUrl || loading || error) {
        return;
      }

      void ensurePreviewUrl();
    }, [ensurePreviewUrl, error, failed, fetchMissingPreview, loading, previewUrl, sourceEnabled]);

    useEffect(() => {
      if (!previewUrl || previewUrl === activeSrc || playingRef.current || failed) {
        return;
      }

      const video = videoRef.current;
      pendingRestoreRef.current = video
        ? { currentTime: readableCurrentTime(video), resume: false }
        : null;
      setActiveSrc(previewUrl);
    }, [activeSrc, failed, previewUrl]);

    useEffect(() => {
      if (recoveryPhaseRef.current === 'retrying' && activeSrc === retrySrcRef.current) {
        retrySourceActiveRef.current = true;
      }
    }, [activeSrc]);

    const adoptDeferredPreview = useCallback(
      (video: HTMLVideoElement, resume: boolean, resetTime = false) => {
        if (!previewUrl || previewUrl === activeSrc) {
          return;
        }

        pendingRestoreRef.current = {
          currentTime: resetTime ? 0 : readableCurrentTime(video),
          resume,
        };
        setActiveSrc(previewUrl);
      },
      [activeSrc, previewUrl]
    );

    function handlePlay(event: SyntheticEvent<HTMLVideoElement>) {
      playingRef.current = true;
      onPlay?.(event);
    }

    function handlePause(event: SyntheticEvent<HTMLVideoElement>) {
      playingRef.current = false;
      adoptDeferredPreview(event.currentTarget, false);
      onPause?.(event);
    }

    function handleEnded(event: SyntheticEvent<HTMLVideoElement>) {
      playingRef.current = false;
      adoptDeferredPreview(event.currentTarget, false, true);
      onEnded?.(event);
    }

    function handleLoadedMetadata(event: SyntheticEvent<HTMLVideoElement>) {
      const restore = pendingRestoreRef.current;
      if (restore) {
        pendingRestoreRef.current = null;
        event.currentTarget.currentTime = restore.currentTime;
        if (restore.resume && playbackActiveRef.current) {
          void event.currentTarget.play().catch(() => {
            // The source recovered even if browser autoplay policy requires a new user gesture.
          });
        }
      }
      onLoadedMetadata?.(event);
    }

    function handleError(event: SyntheticEvent<HTMLVideoElement>) {
      onError?.(event);

      if (recoveryPhaseRef.current === 'refreshing') {
        return;
      }

      if (recoveryPhaseRef.current === 'retrying') {
        if (
          !retrySourceActiveRef.current &&
          event.currentTarget.getAttribute('src') !== retrySrcRef.current
        ) {
          return;
        }
        setFailed(true);
        return;
      }

      recoveryPhaseRef.current = 'refreshing';
      const failedVideo = event.currentTarget;
      const restore: PendingRestore = {
        currentTime: readableCurrentTime(failedVideo),
        resume: playingRef.current && playbackActiveRef.current,
      };

      void ensurePreviewUrl(true).then((freshUrl) => {
        if (!freshUrl) {
          setFailed(true);
          return;
        }

        pendingRestoreRef.current = restore;
        retrySrcRef.current = freshUrl;
        recoveryPhaseRef.current = 'retrying';
        if (failedVideo.getAttribute('src') === freshUrl) {
          retrySourceActiveRef.current = true;
          failedVideo.load();
          return;
        }
        setActiveSrc(freshUrl);
      });
    }

    async function openArtifact() {
      const url = activeSrc ?? previewUrl ?? (await ensurePreviewUrl(true));
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    }

    if (!sourceEnabled) {
      return <video {...videoProps} preload="none" ref={setVideoRef} />;
    }

    if (failed || (error && !activeSrc)) {
      const openUrl = previewUrl ?? activeSrc;
      return (
        <div
          className="grid justify-items-center gap-3 rounded-xl border border-border/60 bg-background/52 p-4 text-center text-sm text-muted-foreground"
          role="alert"
        >
          {fallback ?? <p>This video cannot be played in your browser.</p>}
          {!showOpenAction ? null : openUrl ? (
            <Button asChild size="sm" variant="outline">
              <a href={openUrl} rel="noreferrer" target="_blank">
                Open artifact
              </a>
            </Button>
          ) : (
            <Button disabled={loading} onClick={() => void openArtifact()} size="sm" type="button">
              Open artifact
            </Button>
          )}
        </div>
      );
    }

    if (!activeSrc) {
      return (
        <p className="p-4 text-sm text-muted-foreground" role="status">
          Loading video preview...
        </p>
      );
    }

    return (
      <video
        {...videoProps}
        onEnded={handleEnded}
        onError={handleError}
        onLoadedMetadata={handleLoadedMetadata}
        onPause={handlePause}
        onPlay={handlePlay}
        ref={setVideoRef}
        src={activeSrc}
      />
    );
  }
);

ResilientArtifactVideo.displayName = 'ResilientArtifactVideo';

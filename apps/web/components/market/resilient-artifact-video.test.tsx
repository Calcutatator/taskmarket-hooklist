import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ArtifactResponse } from '@taskmarket/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ResilientArtifactVideo } from './resilient-artifact-video';

function videoArtifact(overrides: Partial<ArtifactResponse> = {}): ArtifactResponse {
  return {
    displayOrder: 0,
    fileName: 'walkthrough.mp4',
    id: 'artifact-video',
    keccak256Hash: '0xkeccak',
    mediaKind: 'video',
    mimeType: 'video/mp4',
    previewExpiresAt: new Date(Date.now() + 40_000).toISOString(),
    previewUrl: 'https://files.example.com/walkthrough.mp4?signature=old',
    role: 'final',
    sha256Hash: 'sha256',
    sizeBytes: 1024,
    storageUri: 's3://bucket/walkthrough.mp4',
    submissionId: 'submission-1',
    taskId: 'task-1',
    workerAddress: '0x3333333333333333333333333333333333333333',
    workerAgentId: null,
    ...overrides,
  };
}

function successfulPreviewResponse(url: string) {
  return {
    json: async () => ({
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      previewUrl: url,
    }),
    ok: true,
  } as Response;
}

describe('ResilientArtifactVideo', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('keeps a playing source stable and adopts a polled replacement after pause', async () => {
    const initial = videoArtifact();
    const { container, rerender } = render(<ResilientArtifactVideo artifact={initial} controls />);
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute('src', initial.previewUrl);

    fireEvent.play(video!);
    act(() => vi.advanceTimersByTime(15_000));
    const freshUrl = 'https://files.example.com/walkthrough.mp4?signature=polled';
    rerender(
      <ResilientArtifactVideo
        artifact={videoArtifact({
          previewExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          previewUrl: freshUrl,
        })}
        controls
      />
    );

    await act(async () => undefined);
    expect(video).toHaveAttribute('src', initial.previewUrl);

    fireEvent.pause(video!);
    await waitFor(() => expect(video).toHaveAttribute('src', freshUrl));
  });

  it('refreshes a failed source once, restores time, and resumes play intent', async () => {
    const freshUrl = 'https://files.example.com/walkthrough.mp4?signature=recovered';
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(successfulPreviewResponse(freshUrl));
    const { container } = render(<ResilientArtifactVideo artifact={videoArtifact()} controls />);
    const video = container.querySelector('video')!;
    const play = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(video, 'play', { configurable: true, value: play });
    video.currentTime = 18.5;
    fireEvent.play(video);

    fireEvent.error(video);

    await waitFor(() => expect(video).toHaveAttribute('src', freshUrl));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/tasks/task-1/artifacts/artifact-video/preview')
    );

    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(18.5);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('does not resume a recovered source after playback becomes inactive', async () => {
    const freshUrl = 'https://files.example.com/walkthrough.mp4?signature=recovered';
    let resolveFetch: ((response: Response) => void) | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    const artifact = videoArtifact();
    const { container, rerender } = render(
      <ResilientArtifactVideo artifact={artifact} controls playbackActive />
    );
    const video = container.querySelector('video')!;
    const pause = vi.fn();
    const play = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(video, 'pause', { configurable: true, value: pause });
    Object.defineProperty(video, 'paused', { configurable: true, value: false });
    Object.defineProperty(video, 'play', { configurable: true, value: play });
    video.currentTime = 18.5;
    fireEvent.play(video);
    fireEvent.error(video);

    rerender(<ResilientArtifactVideo artifact={artifact} controls playbackActive={false} />);
    expect(pause).toHaveBeenCalledTimes(1);

    resolveFetch?.(successfulPreviewResponse(freshUrl));
    await waitFor(() => expect(video).toHaveAttribute('src', freshUrl));
    fireEvent.loadedMetadata(video);

    expect(video.currentTime).toBe(18.5);
    expect(play).not.toHaveBeenCalled();
  });

  it('ignores duplicate errors from the original source while recovery is in flight', async () => {
    const freshUrl = 'https://files.example.com/walkthrough.mp4?signature=recovered';
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    const { container } = render(<ResilientArtifactVideo artifact={videoArtifact()} controls />);
    const video = container.querySelector('video')!;

    fireEvent.error(video);
    fireEvent.error(video);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch?.(successfulPreviewResponse(freshUrl));
    await waitFor(() => expect(video).toHaveAttribute('src', freshUrl));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.error(video);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('reloads the media element when a forced refresh returns the same signed URL', async () => {
    const initial = videoArtifact();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(successfulPreviewResponse(initial.previewUrl!));
    const { container } = render(<ResilientArtifactVideo artifact={initial} controls />);
    const video = container.querySelector('video')!;
    const load = vi.fn();
    Object.defineProperty(video, 'load', { configurable: true, value: load });

    fireEvent.error(video);

    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(video).toHaveAttribute('src', initial.previewUrl);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('stops after one media recovery and exposes an accessible Open artifact fallback', async () => {
    const freshUrl = 'https://files.example.com/walkthrough.mp4?signature=recovered';
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(successfulPreviewResponse(freshUrl));
    const { container } = render(<ResilientArtifactVideo artifact={videoArtifact()} controls />);
    const video = container.querySelector('video')!;

    fireEvent.error(video);
    await waitFor(() => expect(video).toHaveAttribute('src', freshUrl));
    fireEvent.error(video);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This video cannot be played in your browser.'
    );
    expect(screen.getByRole('link', { name: 'Open artifact' })).toHaveAttribute('href', freshUrl);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector('video')).toBeNull();
  });

  it('recovers media failures while inactive and can omit an action inside an interactive parent', async () => {
    const freshUrl = 'https://files.example.com/walkthrough.mp4?signature=recovered';
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(successfulPreviewResponse(freshUrl));
    const { container } = render(
      <ResilientArtifactVideo
        artifact={videoArtifact()}
        fetchMissingPreview={false}
        showOpenAction={false}
      />
    );
    const video = container.querySelector('video')!;

    fireEvent.error(video);
    await waitFor(() => expect(video).toHaveAttribute('src', freshUrl));
    fireEvent.error(video);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open artifact' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open artifact' })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('forwards native video options and reports the newest usable preview URL', async () => {
    const onPreviewUrlChange = vi.fn();
    const { container } = render(
      <ResilientArtifactVideo
        artifact={videoArtifact()}
        className="media-class"
        controls
        muted
        onPreviewUrlChange={onPreviewUrlChange}
        playsInline
        preload="metadata"
      />
    );
    const video = container.querySelector('video')!;

    expect(video).toHaveClass('media-class');
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveProperty('muted', true);
    expect(video).toHaveAttribute('playsinline');
    expect(video).toHaveAttribute('preload', 'metadata');
    await waitFor(() =>
      expect(onPreviewUrlChange).toHaveBeenLastCalledWith(videoArtifact().previewUrl)
    );
  });
});

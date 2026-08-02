import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactResponse } from '@taskmarket/shared';
import { createContext, useContext, type ReactNode } from 'react';

import { ArtifactMediaHero, ArtifactMediaTile } from './artifact-preview-button';

// A controllable IntersectionObserver stub for asserting the "not yet in view"
// state distinctly from "in view" -- unlike IntersectionObserverStub below (which
// reports intersecting immediately), this only fires when the test calls
// `trigger()`, so lazy-mount tests can assert nothing mounted beforehand.
class ManualIntersectionObserverStub {
  static instances: ManualIntersectionObserverStub[] = [];

  private readonly callback: IntersectionObserverCallback;
  private target: Element | null = null;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    ManualIntersectionObserverStub.instances.push(this);
  }

  disconnect() {}

  observe(target: Element) {
    this.target = target;
  }

  takeRecords() {
    return [];
  }

  trigger(isIntersecting: boolean) {
    const target = this.target;
    if (!target) return;
    this.callback(
      [
        {
          boundingClientRect: target.getBoundingClientRect(),
          intersectionRatio: isIntersecting ? 1 : 0,
          intersectionRect: target.getBoundingClientRect(),
          isIntersecting,
          rootBounds: null,
          target,
          time: 0,
        },
      ],
      this as unknown as IntersectionObserver
    );
  }

  unobserve() {}
}

// The poster tiles lazy-mount their live iframe via IntersectionObserver, which
// jsdom does not implement. This stub reports every observed element as
// immediately intersecting, mirroring the pattern already used for
// try-experience.test.tsx, so poster tests can assert on the mounted content
// without waiting on real viewport geometry.
class IntersectionObserverStub {
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }

  disconnect() {}

  observe(target: Element) {
    this.callback(
      [
        {
          boundingClientRect: target.getBoundingClientRect(),
          intersectionRatio: 1,
          intersectionRect: target.getBoundingClientRect(),
          isIntersecting: true,
          rootBounds: null,
          target,
          time: 0,
        },
      ],
      this as unknown as IntersectionObserver
    );
  }

  takeRecords() {
    return [];
  }

  unobserve() {}
}

// vaul drives its bottom-sheet drag gesture off the Pointer Events + CSS transform
// APIs, neither of which jsdom implements, so any userEvent.click inside a real
// vaul Drawer throws (setPointerCapture is not a function; getTranslate parses an
// undefined computed transform). The repo already mocks 'motion/react' at the test
// boundary for the same class of animation-library/jsdom mismatch (see
// submission-gallery.test.tsx); this mirrors that pattern for vaul so the drawer's
// own structure (rendered by components/ui/drawer.tsx) still gets exercised for
// real, including open/close gating, without the unrelated gesture engine crashing.
const mockDrawerOpenContext = createContext(false);

vi.mock('vaul', () => {
  function Root({ children, open }: { children: ReactNode; open?: boolean }) {
    return (
      <mockDrawerOpenContext.Provider value={!!open}>{children}</mockDrawerOpenContext.Provider>
    );
  }
  function Trigger(props: Record<string, unknown>) {
    return <button type="button" {...props} />;
  }
  function Portal({ children }: { children: ReactNode }) {
    const open = useContext(mockDrawerOpenContext);
    return open ? children : null;
  }
  function Overlay(props: Record<string, unknown>) {
    return <div {...props} />;
  }
  function Close(props: Record<string, unknown>) {
    return <button type="button" {...props} />;
  }
  function Content(props: Record<string, unknown>) {
    return <div role="dialog" {...props} />;
  }
  function Title(props: Record<string, unknown>) {
    return <h2 {...props} />;
  }
  function Description(props: Record<string, unknown>) {
    return <p {...props} />;
  }

  return {
    Drawer: { Root, Trigger, Portal, Overlay, Close, Content, Title, Description },
  };
});

function setupMatchMedia(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
  });

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: width < 768,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
    })),
  });
}

function artifact(overrides: Partial<ArtifactResponse> = {}): ArtifactResponse {
  return {
    displayOrder: 0,
    fileName: 'candidate-a-calculator.html',
    id: 'artifact-html',
    keccak256Hash: '0xkeccak',
    mediaKind: 'text',
    mimeType: 'text/html',
    previewUrl: 'https://files.example.com/candidate-a-calculator.html',
    role: 'final',
    sha256Hash: 'sha256',
    sizeBytes: 900 * 1024,
    storageUri: 's3://bucket/candidate-a-calculator.html',
    submissionId: 'sub-1',
    taskId: 'task-1',
    workerAddress: '0x3333333333333333333333333333333333333333',
    workerAgentId: null,
    ...overrides,
  };
}

async function openPreview(fileName = 'candidate-a-calculator.html') {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: new RegExp(`open ${fileName}`, 'i') }));
  return user;
}

describe('ArtifactPreviewTrigger mobile/desktop branch', () => {
  it('renders the drawer surface, not the centered dialog, below the md breakpoint', async () => {
    setupMatchMedia(390);
    const htmlArtifact = artifact();
    render(<ArtifactMediaTile artifact={htmlArtifact} taskId="task-1" />);

    await openPreview();

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="drawer-content"]')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeInTheDocument();
  });

  it('still uses the centered dialog at and above the md breakpoint', async () => {
    setupMatchMedia(1280);
    const htmlArtifact = artifact();
    render(<ArtifactMediaTile artifact={htmlArtifact} taskId="task-1" />);

    await openPreview();

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="drawer-content"]')).not.toBeInTheDocument();
  });

  it('does not render the filename, mimetype, or byte size in the visible mobile header', async () => {
    setupMatchMedia(390);
    const htmlArtifact = artifact();
    render(<ArtifactMediaTile artifact={htmlArtifact} taskId="task-1" />);

    await openPreview();

    const topbar = await screen.findByTestId('mobile-artifact-preview-topbar');
    expect(topbar.textContent).not.toMatch(/candidate-a-calculator\.html/i);
    expect(topbar.textContent).not.toMatch(/text\/html/i);
    expect(topbar.textContent).not.toMatch(/900 KB/i);
  });

  it('still exposes the filename and size as an accessible (visually hidden) title for screen readers', async () => {
    setupMatchMedia(390);
    const htmlArtifact = artifact();
    render(<ArtifactMediaTile artifact={htmlArtifact} taskId="task-1" />);

    await openPreview();

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('candidate-a-calculator.html')).toBeInTheDocument();
    expect(within(dialog).getByText(/text\/html \/ 900 KB/i)).toBeInTheDocument();
  });

  it('keeps the untrusted-HTML warning collapsed behind a chip until tapped, then reveals the full text', async () => {
    setupMatchMedia(390);
    const htmlContent = '<html><body><output>ready</output></body></html>';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => htmlContent,
    } as Response);
    const htmlArtifact = artifact();
    render(<ArtifactMediaTile artifact={htmlArtifact} taskId="task-1" />);
    const user = await openPreview();

    const dialog = await screen.findByRole('dialog');
    await screen.findByTitle('Interactive preview of candidate-a-calculator.html');

    expect(
      within(dialog).queryByText(/untrusted interactive html.*do not enter passwords/i)
    ).not.toBeInTheDocument();

    const chip = within(dialog).getByRole('button', { name: /untrusted html/i });
    expect(chip).toHaveAttribute('aria-expanded', 'false');

    await user.click(chip);

    expect(chip).toHaveAttribute('aria-expanded', 'true');
    expect(
      within(dialog).getByText(/untrusted interactive html.*do not enter passwords/i)
    ).toBeInTheDocument();

    fetchMock.mockRestore();
  });

  it('does not render ArtifactMetadata on mobile until the Details disclosure is opened', async () => {
    setupMatchMedia(390);
    const htmlContent = '<html><body><output>ready</output></body></html>';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => htmlContent,
    } as Response);
    const htmlArtifact = artifact();
    render(<ArtifactMediaTile artifact={htmlArtifact} taskId="task-1" />);
    const user = await openPreview();

    const dialog = await screen.findByRole('dialog');
    await screen.findByTitle('Interactive preview of candidate-a-calculator.html');

    expect(within(dialog).queryByText(/sha-256/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/keccak-256/i)).not.toBeInTheDocument();

    const detailsToggle = within(dialog).getByRole('button', { name: /details/i });
    expect(detailsToggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(detailsToggle);

    expect(detailsToggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(dialog).getByText(/sha-256/i)).toBeInTheDocument();
    expect(within(dialog).getByText('0xkeccak')).toBeInTheDocument();

    fetchMock.mockRestore();
  });

  it.each([
    ['mobile', 390],
    ['desktop', 1280],
  ])('keeps the iframe sandboxed to allow-scripts on %s', async (_label, width) => {
    setupMatchMedia(width);
    const htmlContent = '<html><body><output>ready</output></body></html>';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => htmlContent,
    } as Response);
    const htmlArtifact = artifact();
    render(<ArtifactMediaTile artifact={htmlArtifact} taskId="task-1" />);
    await openPreview();

    const frame = await screen.findByTitle('Interactive preview of candidate-a-calculator.html');
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    expect(frame).toHaveAttribute('allow', '');
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(frame.getAttribute('srcdoc')).toContain("default-src 'none'");

    fetchMock.mockRestore();
  });

  it('shows the oversized-limit message and renders no iframe for an HTML artifact over the size limit on mobile', async () => {
    setupMatchMedia(390);
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const oversized = artifact({
      fileName: 'oversized.html',
      id: 'artifact-html-oversized',
      sizeBytes: 6 * 1024 * 1024,
    });
    render(<ArtifactMediaTile artifact={oversized} taskId="task-1" />);

    await openPreview('oversized.html');

    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText(/exceeds the 5 mb interactive preview limit/i)
    ).toBeInTheDocument();
    expect(dialog.querySelector('iframe')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockRestore();
  });

  it('renders an image artifact unchanged in the desktop dialog', async () => {
    setupMatchMedia(1280);
    const imageArtifact = artifact({
      fileName: 'poster.png',
      id: 'artifact-image',
      mediaKind: 'image',
      mimeType: 'image/png',
      previewUrl: 'https://files.example.com/poster.png',
    });
    render(<ArtifactMediaTile artifact={imageArtifact} taskId="task-1" />);

    await openPreview('poster.png');

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByAltText('poster.png')).toHaveAttribute(
      'src',
      'https://files.example.com/poster.png'
    );
  });

  it('renders an image artifact inside the mobile sheet, filling the available space', async () => {
    setupMatchMedia(390);
    const imageArtifact = artifact({
      fileName: 'poster.png',
      id: 'artifact-image',
      mediaKind: 'image',
      mimeType: 'image/png',
      previewUrl: 'https://files.example.com/poster.png',
    });
    render(<ArtifactMediaTile artifact={imageArtifact} taskId="task-1" />);

    await openPreview('poster.png');

    const dialog = await screen.findByRole('dialog');
    const image = within(dialog).getByAltText('poster.png');
    expect(image).toHaveAttribute('src', 'https://files.example.com/poster.png');
    expect(image).toHaveClass('h-full');
  });
});

describe('ArtifactMediaTile poster (closed, pre-click)', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders a sandboxed live iframe poster for an HTML artifact instead of the generic file fallback', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => '<html><body>demo</body></html>',
    } as Response);
    const htmlArtifact = artifact();
    render(<ArtifactMediaTile artifact={htmlArtifact} taskId="task-1" />);

    const tile = screen.getByRole('button', { name: /open candidate-a-calculator\.html/i });
    const frame = await within(tile).findByTitle(
      'Interactive preview of candidate-a-calculator.html'
    );

    expect(frame.tagName).toBe('IFRAME');
    expect(within(tile).queryByText(/text\/html/i)).not.toBeInTheDocument();

    fetchMock.mockRestore();
  });

  it('keeps the poster iframe non-interactive and sandboxed, with the tile as the only click target', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => '<html><body>demo</body></html>',
    } as Response);
    const htmlArtifact = artifact();
    render(<ArtifactMediaTile artifact={htmlArtifact} taskId="task-1" />);

    const tile = screen.getByRole('button', { name: /open candidate-a-calculator\.html/i });
    const frame = await within(tile).findByTitle(
      'Interactive preview of candidate-a-calculator.html'
    );

    // The iframe itself must never be an activatable control -- pointer-events-none
    // keeps clicks/hovers on the poster from ever reaching untrusted sandboxed
    // content, so the outer <button> stays the single click target that opens the
    // full viewer.
    expect(frame).toHaveClass('pointer-events-none');
    expect(tile.querySelectorAll('button, a, [role="button"]')).toHaveLength(0);

    // Security regression guard: the poster reuses the same sandboxed iframe
    // contract as the full-size preview -- scripts allowed, nothing else.
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    expect(frame).toHaveAttribute('allow', '');
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(frame.getAttribute('srcdoc')).toContain("default-src 'none'");

    fetchMock.mockRestore();
  });

  it('does not mount a live iframe poster for an oversized HTML artifact', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const oversized = artifact({
      fileName: 'oversized.html',
      id: 'artifact-html-oversized',
      sizeBytes: 6 * 1024 * 1024,
    });
    render(<ArtifactMediaTile artifact={oversized} taskId="task-1" />);

    const tile = screen.getByRole('button', { name: /open oversized\.html/i });

    expect(tile.querySelector('iframe')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockRestore();
  });

  it('renders a text artifact poster as actual content lines, not a mimetype string', () => {
    const textArtifact = artifact({
      fileName: 'notes.md',
      id: 'artifact-text',
      mediaKind: 'text',
      mimeType: 'text/markdown',
      previewUrl: undefined,
      textPreview: 'First finding\nSecond finding\nThird finding',
    });
    render(<ArtifactMediaTile artifact={textArtifact} taskId="task-1" />);

    const tile = screen.getByRole('button', { name: /open notes\.md/i });

    expect(within(tile).getByText('First finding')).toBeInTheDocument();
    expect(within(tile).getByText('Second finding')).toBeInTheDocument();
    expect(within(tile).queryByText(/text\/markdown/i)).not.toBeInTheDocument();
  });

  it('does not mount the live HTML poster until the tile is observed near the viewport, then mounts once it is', async () => {
    vi.unstubAllGlobals();
    ManualIntersectionObserverStub.instances.length = 0;
    vi.stubGlobal('IntersectionObserver', ManualIntersectionObserverStub);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => '<html><body>demo</body></html>',
    } as Response);
    const htmlArtifact = artifact();
    render(<ArtifactMediaTile artifact={htmlArtifact} taskId="task-1" />);

    const tile = screen.getByRole('button', { name: /open candidate-a-calculator\.html/i });

    // Before the observer reports an intersection, the poster has not mounted the
    // live iframe (and has issued no fetch for its content) -- the fallback stays.
    expect(tile.querySelector('iframe')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => {
      ManualIntersectionObserverStub.instances[0]?.trigger(true);
    });

    const frame = await within(tile).findByTitle(
      'Interactive preview of candidate-a-calculator.html'
    );
    expect(frame).toBeInTheDocument();

    fetchMock.mockRestore();
  });

  it('fails closed (renders the static fallback, never fetches) when IntersectionObserver is unavailable', async () => {
    vi.unstubAllGlobals();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => '<html><body>demo</body></html>',
    } as Response);
    const htmlArtifact = artifact();
    render(<ArtifactMediaTile artifact={htmlArtifact} taskId="task-1" />);

    const tile = screen.getByRole('button', { name: /open candidate-a-calculator\.html/i });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tile.querySelector('iframe')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockRestore();
  });

  it('renders an image artifact unchanged in the closed tile (regression guard)', () => {
    const imageArtifact = artifact({
      fileName: 'poster.png',
      id: 'artifact-image',
      mediaKind: 'image',
      mimeType: 'image/png',
      previewUrl: 'https://files.example.com/poster.png',
    });
    render(<ArtifactMediaTile artifact={imageArtifact} taskId="task-1" />);

    expect(screen.getByAltText('poster.png')).toHaveAttribute(
      'src',
      'https://files.example.com/poster.png'
    );
  });

  it('keeps an off-screen video tile network-idle until it approaches the viewport', () => {
    vi.unstubAllGlobals();
    ManualIntersectionObserverStub.instances.length = 0;
    vi.stubGlobal('IntersectionObserver', ManualIntersectionObserverStub);
    const videoArtifact = artifact({
      fileName: 'clip.mp4',
      id: 'artifact-video',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      previewUrl: 'https://files.example.com/clip.mp4',
    });
    const { container } = render(<ArtifactMediaTile artifact={videoArtifact} taskId="task-1" />);

    expect(container.querySelector('video')).not.toHaveAttribute('src');

    act(() => {
      ManualIntersectionObserverStub.instances[0]?.trigger(true);
    });

    expect(container.querySelector('video')).toHaveAttribute('src', videoArtifact.previewUrl);
  });
});

describe('artifact video integration', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps the controlled tile video source stable across activity polling', () => {
    const videoArtifact = artifact({
      fileName: 'clip.mp4',
      id: 'artifact-video',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      previewUrl: 'https://files.example.com/clip-first.mp4',
    });
    const { container, rerender } = render(
      <ArtifactMediaTile artifact={videoArtifact} taskId="task-1" />
    );

    const video = container.querySelector('video');
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveAttribute('src', 'https://files.example.com/clip-first.mp4');

    rerender(
      <ArtifactMediaTile
        artifact={{
          ...videoArtifact,
          previewUrl: 'https://files.example.com/clip-from-next-poll.mp4',
        }}
        taskId="task-1"
      />
    );

    expect(container.querySelector('video')).toHaveAttribute(
      'src',
      'https://files.example.com/clip-first.mp4'
    );
  });

  it('preserves hero click-to-open behavior around the resilient video', async () => {
    vi.unstubAllGlobals();
    ManualIntersectionObserverStub.instances.length = 0;
    vi.stubGlobal('IntersectionObserver', ManualIntersectionObserverStub);
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const videoArtifact = artifact({
      fileName: 'clip.mp4',
      id: 'artifact-video',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      previewUrl: 'https://files.example.com/clip.mp4',
    });
    const { container } = render(
      <ArtifactMediaHero artifact={videoArtifact} onOpen={onOpen} taskId="task-1" />
    );

    expect(container.querySelector('video')).not.toHaveAttribute('src');

    await user.click(screen.getByRole('button', { name: /open clip\.mp4 preview/i }));

    expect(onOpen).toHaveBeenCalledOnce();

    act(() => {
      ManualIntersectionObserverStub.instances[0]?.trigger(true);
    });

    expect(container.querySelector('video')).toHaveAttribute('src', videoArtifact.previewUrl);
  });

  it('waits until a video tile approaches the viewport, then reuses its fetched URL when opening', async () => {
    vi.unstubAllGlobals();
    ManualIntersectionObserverStub.instances.length = 0;
    vi.stubGlobal('IntersectionObserver', ManualIntersectionObserverStub);
    const user = userEvent.setup();
    const freshUrl = 'https://files.example.com/clip-fetched.mp4';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: async () => ({
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        previewUrl: freshUrl,
      }),
      ok: true,
    } as Response);
    const videoArtifact = artifact({
      fileName: 'clip.mp4',
      id: 'artifact-video',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      previewExpiresAt: undefined,
      previewUrl: undefined,
    });
    const { container } = render(<ArtifactMediaTile artifact={videoArtifact} taskId="task-1" />);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector('video')).not.toHaveAttribute('src');

    act(() => {
      ManualIntersectionObserverStub.instances[0]?.trigger(true);
    });

    await waitFor(() => expect(container.querySelector('video')).toHaveAttribute('src', freshUrl));
    await user.click(screen.getByRole('button', { name: /open clip\.mp4 preview/i }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('dialog').querySelector('video')).toHaveAttribute('src', freshUrl);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('exposes the hero fallback action after recovery is exhausted without nesting controls', async () => {
    const freshUrl = 'https://files.example.com/clip-recovered.mp4';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: async () => ({ previewUrl: freshUrl }),
      ok: true,
    } as Response);
    const videoArtifact = artifact({
      fileName: 'clip.mp4',
      id: 'artifact-video',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      previewUrl: 'https://files.example.com/clip.mp4',
    });
    const { container } = render(
      <ArtifactMediaHero artifact={videoArtifact} onOpen={vi.fn()} taskId="task-1" />
    );
    const video = container.querySelector('video')!;

    fireEvent.error(video);
    await waitFor(() => expect(video).toHaveAttribute('src', freshUrl));
    fireEvent.error(video);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This video cannot be played in your browser.'
    );
    expect(screen.getByRole('link', { name: 'Open artifact' })).toHaveAttribute('href', freshUrl);
    expect(container.querySelector('button a')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

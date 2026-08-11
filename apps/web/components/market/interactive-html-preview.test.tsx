import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactResponse } from '@taskmarket/shared';

import { InteractiveHtmlPreview } from './interactive-html-preview';
import { MAX_INTERACTIVE_HTML_BYTES } from '@/lib/sandboxed-html';

const htmlArtifact: ArtifactResponse = {
  displayOrder: 0,
  fileName: 'result.html',
  id: 'artifact-html',
  keccak256Hash: `0x${'2'.repeat(64)}`,
  mediaKind: 'text',
  mimeType: 'text/html',
  role: 'final',
  sha256Hash: '1'.repeat(64),
  sizeBytes: 1024,
  storageUri: 's3://taskmarket/result.html',
  submissionId: 'submission-1',
  taskId: 'task-1',
  workerAddress: '0x1111111111111111111111111111111111111111',
  workerAgentId: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('InteractiveHtmlPreview', () => {
  it('rejects an oversized response from Content-Length before reading its body', async () => {
    const text = vi.fn().mockResolvedValue('<html><body>small lie</body></html>');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        body: null,
        headers: new Headers({ 'content-length': String(MAX_INTERACTIVE_HTML_BYTES + 1) }),
        ok: true,
        text,
      })
    );

    render(
      <InteractiveHtmlPreview artifact={htmlArtifact} previewUrl="https://files/result.html" />
    );

    expect(await screen.findByText(/exceeds the 5 mb interactive preview limit/i)).toBeVisible();
    expect(text).not.toHaveBeenCalled();
  });

  it('stops reading a streamed response as soon as it crosses the preview limit', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const read = vi
      .fn()
      .mockResolvedValueOnce({ done: false, value: new Uint8Array(MAX_INTERACTIVE_HTML_BYTES) })
      .mockResolvedValueOnce({ done: false, value: new Uint8Array(1) });
    const text = vi.fn().mockResolvedValue('<html><body>should not be used</body></html>');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        body: { getReader: () => ({ cancel, read }) },
        headers: new Headers(),
        ok: true,
        text,
      })
    );

    render(
      <InteractiveHtmlPreview artifact={htmlArtifact} previewUrl="https://files/result.html" />
    );

    expect(await screen.findByText(/exceeds the 5 mb interactive preview limit/i)).toBeVisible();
    expect(read).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledOnce();
    expect(text).not.toHaveBeenCalled();
  });

  it('requests a fresh signed URL before retrying a failed body fetch', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 403 })
      .mockResolvedValueOnce({
        body: null,
        headers: new Headers(),
        ok: true,
        text: async () => '<html><body>Recovered result</body></html>',
      });
    const onRetry = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(
      <InteractiveHtmlPreview
        artifact={htmlArtifact}
        onRetry={onRetry}
        previewUrl="https://files/expired.html"
      />
    );

    const alert = await screen.findByRole('alert');
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));

    expect(onRetry).toHaveBeenCalledOnce();
    expect(await screen.findByTitle('Interactive preview of result.html')).toBeInTheDocument();
  });
});

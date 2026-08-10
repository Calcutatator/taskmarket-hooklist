import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ArtifactResponse } from '@taskmarket/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PublishedHtmlResult } from './published-html-result';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/tasks/task-1',
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams('artifact=artifact-html&from=social'),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/market/artifact-preview-button', () => ({
  ArtifactPreviewTrigger: ({
    autoOpen,
    children,
    onPreviewOpenChange,
  }: {
    autoOpen?: boolean;
    children: () => React.ReactNode;
    onPreviewOpenChange?: (open: boolean) => void;
  }) => (
    <div data-auto-open={autoOpen ? 'true' : 'false'}>
      {children()}
      <button onClick={() => onPreviewOpenChange?.(false)} type="button">
        Close preview
      </button>
    </div>
  ),
}));

const artifact: ArtifactResponse = {
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
  replace.mockReset();
  vi.unstubAllGlobals();
});

describe('PublishedHtmlResult', () => {
  it('renders the stable task deep link and shares the absolute URL', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, share });
    const user = userEvent.setup();

    render(
      <PublishedHtmlResult
        artifact={artifact}
        artifactCount={3}
        href="/tasks/task-1?artifact=artifact-html"
        taskId="task-1"
        taskTitle="Build an interactive report"
      />
    );

    expect(screen.getByRole('link', { name: /open interactive result/i })).toHaveAttribute(
      'href',
      '/tasks/task-1?artifact=artifact-html'
    );
    expect(screen.getByTitle('result.html')).toHaveTextContent('3 HTML results');

    await user.click(screen.getByRole('button', { name: 'Share interactive result' }));
    expect(share).toHaveBeenCalledWith({
      text: 'View the interactive HTML result on Taskmarket.',
      title: 'Build an interactive report',
      url: 'http://localhost:3000/tasks/task-1?artifact=artifact-html',
    });
  });

  it('opens a selected deep link and removes only the artifact query when closed', async () => {
    const user = userEvent.setup();

    render(
      <PublishedHtmlResult
        artifact={artifact}
        artifactCount={1}
        href="/tasks/task-1?artifact=artifact-html"
        initiallyOpen
        taskId="task-1"
        taskTitle="Build an interactive report"
      />
    );

    expect(document.querySelector('[data-auto-open="true"]')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close preview' }));
    expect(replace).toHaveBeenCalledWith('/tasks/task-1?from=social', { scroll: false });
  });
});

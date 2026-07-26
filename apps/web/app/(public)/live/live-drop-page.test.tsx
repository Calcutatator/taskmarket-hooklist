import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const currentTaskDrop = vi.fn();

vi.mock('@/components/market/task-drops/task-drop-detail', () => ({
  TaskDropDetail: () => null,
}));

vi.mock('@/lib/api/server', () => ({
  fetchTaskDrop: vi.fn(),
}));

vi.mock('@/lib/live-drop', () => ({
  currentTaskDrop: (...args: unknown[]) => currentTaskDrop(...args),
}));

vi.mock('../taskdrop/page', () => ({
  default: () => <div>Task Drops landing page</div>,
}));

import LiveDropPage, { generateMetadata } from './page';

describe('LiveDropPage', () => {
  beforeEach(() => {
    currentTaskDrop.mockReset();
  });

  it('renders the Task Drops landing page when there is no current drop', async () => {
    currentTaskDrop.mockResolvedValue(null);

    render(await LiveDropPage());

    expect(screen.getByText('Task Drops landing page')).toBeInTheDocument();
  });

  it('uses the fallback copy and defers to its colocated opengraph image route', async () => {
    currentTaskDrop.mockResolvedValue(null);

    const metadata = await generateMetadata();

    expect(metadata.alternates).toEqual({ canonical: '/live' });
    expect(metadata.title).toBe('The latest Task Drop.');
    expect(metadata.description).toBe('One theme, funded tasks, and the whole market competing.');
    expect(Object.hasOwn(metadata.openGraph ?? {}, 'images')).toBe(false);
    expect(Object.hasOwn(metadata.twitter ?? {}, 'images')).toBe(false);
  });
});

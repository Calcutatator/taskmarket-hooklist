import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchTaskDropDirectory = vi.fn();

vi.mock('@/lib/api/server', () => ({
  fetchTaskDropDirectory: (...args: unknown[]) => fetchTaskDropDirectory(...args),
}));

function drop(id: string, isOfficial: boolean) {
  return {
    drop: {
      announcedAt: null,
      createdAt: '2026-07-24T00:00:00.000Z',
      description: null,
      id,
      isOfficial,
      name: id,
      officialWalletAddress: '0x0000000000000000000000000000000000000001',
      ownerAddress: '0x0000000000000000000000000000000000000001',
    },
  };
}

async function loadCurrentTaskDrop() {
  // react's `cache` memoises per module instance, so re-import per test for a clean slate.
  vi.resetModules();
  return (await import('./live-drop')).currentTaskDrop;
}

describe('currentTaskDrop', () => {
  beforeEach(() => {
    fetchTaskDropDirectory.mockReset();
  });

  it('prefers the first official drop over an earlier community one', async () => {
    fetchTaskDropDirectory.mockResolvedValue({
      items: [drop('community', false), drop('official', true)],
      nextCursor: null,
    });

    const currentTaskDrop = await loadCurrentTaskDrop();
    expect((await currentTaskDrop())?.drop.id).toBe('official');
  });

  it('falls back to the newest row when no drop is official', async () => {
    fetchTaskDropDirectory.mockResolvedValue({
      items: [drop('newest', false), drop('older', false)],
      nextCursor: null,
    });

    const currentTaskDrop = await loadCurrentTaskDrop();
    expect((await currentTaskDrop())?.drop.id).toBe('newest');
  });

  it('returns null when the directory is empty', async () => {
    fetchTaskDropDirectory.mockResolvedValue({ items: [], nextCursor: null });

    const currentTaskDrop = await loadCurrentTaskDrop();
    expect(await currentTaskDrop()).toBeNull();
  });

  // /live is the URL we paste everywhere; a backend blip must degrade, not throw.
  it('returns null rather than throwing when the directory read fails', async () => {
    fetchTaskDropDirectory.mockRejectedValue(new Error('backend down'));

    const currentTaskDrop = await loadCurrentTaskDrop();
    expect(await currentTaskDrop()).toBeNull();
  });
});

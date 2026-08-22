import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ fetchHook: vi.fn() }));

vi.mock('@/lib/api/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/server')>();
  return { ...actual, fetchHook: api.fetchHook };
});

import { ApiConnectionError } from '@/lib/api/server';

import HookPage, { generateMetadata } from './page';

const address = '0x1111111111111111111111111111111111111111';
const canonicalMixedCaseAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const mixedCaseAddress = '0xAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCd';
const hook = {
  activePhaseTaskCount: 1,
  address,
  modes: ['bounty'] as const,
  taskCount: 9,
  taskIds: Array.from({ length: 8 }, (_, index) => `task-${index + 1}`),
};

describe('public Hooklist detail route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchHook.mockResolvedValue(hook);
  });

  it('uses the dedicated address lookup and renders at most eight public task references', async () => {
    render(await HookPage({ params: Promise.resolve({ address }) }));

    expect(api.fetchHook).toHaveBeenCalledWith(address);
    expect(screen.getAllByRole('link', { name: /View task/i })).toHaveLength(8);
  });

  it('uses lowercase canonical metadata and permanently redirects mixed-case addresses', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ address: mixedCaseAddress }),
    });

    expect(metadata.alternates).toEqual({
      canonical: `/hooks/${canonicalMixedCaseAddress}`,
    });
    expect(metadata.openGraph).toMatchObject({
      url: `/hooks/${canonicalMixedCaseAddress}`,
    });
    await expect(
      HookPage({ params: Promise.resolve({ address: mixedCaseAddress }) })
    ).rejects.toMatchObject({
      digest: `NEXT_REDIRECT;replace;/hooks/${canonicalMixedCaseAddress};308;`,
    });
    expect(api.fetchHook).not.toHaveBeenCalled();
  });

  it('returns a Next 404 for malformed and missing hook addresses', async () => {
    await expect(
      HookPage({ params: Promise.resolve({ address: 'not-an-address' }) })
    ).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    expect(api.fetchHook).not.toHaveBeenCalled();

    api.fetchHook.mockResolvedValueOnce(null);
    await expect(HookPage({ params: Promise.resolve({ address }) })).rejects.toMatchObject({
      digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
    });
  });

  it.each([404, 503])(
    'retains an explicit API-unavailable state for an HTTP %s instead of turning it into a Next 404',
    async (status) => {
      api.fetchHook.mockRejectedValue(
        new ApiConnectionError('unavailable', { path: `/api/hooks/${address}`, status })
      );

      render(await HookPage({ params: Promise.resolve({ address }) }));

      expect(screen.getByText('Could not load this hook')).toBeVisible();
      expect(screen.getByText(/public market API is unavailable/i)).toBeVisible();
    }
  );
});

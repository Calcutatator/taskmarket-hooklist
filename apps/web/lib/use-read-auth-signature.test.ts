import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const signMessageAsync = vi.fn();

vi.mock('wagmi', () => ({
  useSignMessage: () => ({ signMessageAsync }),
}));

import { useReadAuthSignature } from './use-read-auth-signature';
import { getCachedReadAuthHeaders } from './read-auth';

const ADDRESS = '0x1111111111111111111111111111111111111111' as const;

describe('useReadAuthSignature', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('signs the canonical taskmarket:read:<address> message and caches the headers once connected', async () => {
    signMessageAsync.mockResolvedValue('0xsignature');
    const { result } = renderHook(() => useReadAuthSignature(ADDRESS));

    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));

    expect(signMessageAsync).toHaveBeenCalledWith({ message: `taskmarket:read:${ADDRESS}` });
    expect(getCachedReadAuthHeaders()).toEqual({
      'X-Taskmarket-Caller-Address': ADDRESS,
      'X-Taskmarket-Caller-Signature': '0xsignature',
    });
  });

  it('does not sign when no address is connected', () => {
    renderHook(() => useReadAuthSignature(undefined));

    expect(signMessageAsync).not.toHaveBeenCalled();
    expect(getCachedReadAuthHeaders()).toEqual({});
  });

  it('falls back to not-ready (not an error) when the wallet rejects the signature', async () => {
    signMessageAsync.mockRejectedValue(new Error('User rejected'));
    const { result } = renderHook(() => useReadAuthSignature(ADDRESS));

    await waitFor(() => expect(signMessageAsync).toHaveBeenCalledTimes(1));
    expect(result.current).toBe(false);
    expect(getCachedReadAuthHeaders()).toEqual({});
  });

  it('signs only once per address across re-renders (cached for the session)', async () => {
    signMessageAsync.mockResolvedValue('0xsignature');
    const { rerender } = renderHook(({ address }) => useReadAuthSignature(address), {
      initialProps: { address: ADDRESS as `0x${string}` | undefined },
    });

    await waitFor(() => expect(signMessageAsync).toHaveBeenCalledTimes(1));

    act(() => rerender({ address: ADDRESS }));
    act(() => rerender({ address: ADDRESS }));

    expect(signMessageAsync).toHaveBeenCalledTimes(1);
  });

  it('re-signs and re-caches when the connected address changes', async () => {
    signMessageAsync.mockResolvedValue('0xsignature');
    const OTHER = '0x2222222222222222222222222222222222222222' as const;
    const { rerender } = renderHook(({ address }) => useReadAuthSignature(address), {
      initialProps: { address: ADDRESS as `0x${string}` | undefined },
    });

    await waitFor(() => expect(signMessageAsync).toHaveBeenCalledTimes(1));

    act(() => rerender({ address: OTHER }));

    await waitFor(() => expect(signMessageAsync).toHaveBeenCalledTimes(2));
    expect(signMessageAsync).toHaveBeenLastCalledWith({ message: `taskmarket:read:${OTHER}` });
    expect(getCachedReadAuthHeaders()).toEqual({
      'X-Taskmarket-Caller-Address': OTHER,
      'X-Taskmarket-Caller-Signature': '0xsignature',
    });
  });

  it('clears the cache when the wallet disconnects', async () => {
    signMessageAsync.mockResolvedValue('0xsignature');
    const { result, rerender } = renderHook(({ address }) => useReadAuthSignature(address), {
      initialProps: { address: ADDRESS as `0x${string}` | undefined },
    });

    await waitFor(() => expect(result.current).toBe(true));

    act(() => rerender({ address: undefined }));

    expect(getCachedReadAuthHeaders()).toEqual({});
  });
});

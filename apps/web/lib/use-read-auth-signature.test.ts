import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const signMessageAsync = vi.fn();

vi.mock('wagmi', () => ({
  useSignMessage: () => ({ signMessageAsync }),
}));

import { useReadAuthSignature, useReadAuthSignatureState } from './use-read-auth-signature';
import { clearCachedReadAuthHeaders, getCachedReadAuthHeaders } from './read-auth';

const ADDRESS = '0x1111111111111111111111111111111111111111' as const;

describe('useReadAuthSignature', () => {
  // The header cache is module-level and now short-circuits signing for a wallet that has
  // already signed, so a signature left behind by one test would suppress the prompt the next
  // one is asserting on. Reset it the way a fresh page load would.
  beforeEach(() => {
    clearCachedReadAuthHeaders();
  });

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

  it('lets an explicit wallet verification recover after a rejected signature', async () => {
    signMessageAsync
      .mockRejectedValueOnce(new Error('User rejected'))
      .mockResolvedValueOnce('0xsignature');
    const { result } = renderHook(() => useReadAuthSignatureState(ADDRESS, { autoStart: false }));

    expect(result.current.status).toBe('idle');
    expect(signMessageAsync).not.toHaveBeenCalled();

    act(() => result.current.requestSignature());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toMatch(/did not approve/i);

    act(() => result.current.requestSignature());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.status).toBe('ready');
    expect(signMessageAsync).toHaveBeenCalledTimes(2);
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

  // The read-auth message carries no nonce, so one signature is good for the whole session.
  // A second consumer mounting later -- an in-flight write starting to poll `intents.get`, in
  // particular -- must read what the first one signed rather than putting a wallet prompt in
  // front of someone mid-wait. This is what makes it one prompt per session, not one per
  // surface.
  it('reuses a session signature for a second consumer without prompting again', async () => {
    signMessageAsync.mockResolvedValue('0xsignature');
    const first = renderHook(() => useReadAuthSignature(ADDRESS));
    await waitFor(() => expect(first.result.current).toBe(true));

    const second = renderHook(() => useReadAuthSignatureState(ADDRESS, { autoStart: false }));

    await waitFor(() => expect(second.result.current.ready).toBe(true));
    expect(signMessageAsync).toHaveBeenCalledTimes(1);
    // And the late consumer must not have cleared the headers it just found.
    expect(getCachedReadAuthHeaders()).toEqual({
      'X-Taskmarket-Caller-Address': ADDRESS,
      'X-Taskmarket-Caller-Signature': '0xsignature',
    });
  });

  it('re-signs and re-caches when the connected address changes', async () => {
    const OTHER = '0x2222222222222222222222222222222222222222' as const;
    let resolveOtherSignature: ((signature: string) => void) | undefined;
    signMessageAsync.mockResolvedValueOnce('0xsignature').mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveOtherSignature = resolve;
        })
    );
    const { result, rerender } = renderHook(({ address }) => useReadAuthSignature(address), {
      initialProps: { address: ADDRESS as `0x${string}` | undefined },
    });

    await waitFor(() => expect(result.current).toBe(true));

    act(() => rerender({ address: OTHER }));

    await waitFor(() => expect(signMessageAsync).toHaveBeenCalledTimes(2));
    expect(signMessageAsync).toHaveBeenLastCalledWith({ message: `taskmarket:read:${OTHER}` });
    expect(result.current).toBe(false);
    expect(getCachedReadAuthHeaders()).toEqual({});

    await act(async () => {
      resolveOtherSignature?.('0xother-signature');
    });

    expect(getCachedReadAuthHeaders()).toEqual({
      'X-Taskmarket-Caller-Address': OTHER,
      'X-Taskmarket-Caller-Signature': '0xother-signature',
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

  it('ignores a signature that resolves after unmounting another wallet consumer', async () => {
    const OTHER = '0x2222222222222222222222222222222222222222' as const;
    let resolveFirstSignature: ((signature: `0x${string}`) => void) | undefined;
    signMessageAsync
      .mockImplementationOnce(
        () =>
          new Promise<`0x${string}`>((resolve) => {
            resolveFirstSignature = resolve;
          })
      )
      .mockResolvedValueOnce('0xother-signature');

    const first = renderHook(() => useReadAuthSignature(ADDRESS));
    await waitFor(() => expect(signMessageAsync).toHaveBeenCalledTimes(1));
    first.unmount();

    const second = renderHook(() => useReadAuthSignature(OTHER));
    await waitFor(() => expect(second.result.current).toBe(true));
    expect(getCachedReadAuthHeaders()).toEqual({
      'X-Taskmarket-Caller-Address': OTHER,
      'X-Taskmarket-Caller-Signature': '0xother-signature',
    });

    await act(async () => {
      resolveFirstSignature?.('0xlate-signature');
    });

    expect(getCachedReadAuthHeaders()).toEqual({
      'X-Taskmarket-Caller-Address': OTHER,
      'X-Taskmarket-Caller-Signature': '0xother-signature',
    });
  });
});

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const signMessageAsync = vi.fn();

vi.mock('wagmi', () => ({
  useSignMessage: () => ({ signMessageAsync }),
}));

import { useInboxSelfAuthSignature } from './use-inbox-self-auth-signature';

const ADDRESS = '0x1111111111111111111111111111111111111111' as const;

describe('useInboxSelfAuthSignature', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('signs the canonical taskmarket:inbox:<address> message once connected', async () => {
    signMessageAsync.mockResolvedValue('0xsignature');
    const { result } = renderHook(() => useInboxSelfAuthSignature(ADDRESS));

    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toBe('0xsignature'));

    expect(signMessageAsync).toHaveBeenCalledWith({ message: `taskmarket:inbox:${ADDRESS}` });
  });

  it('does not sign when no address is connected', () => {
    renderHook(() => useInboxSelfAuthSignature(undefined));

    expect(signMessageAsync).not.toHaveBeenCalled();
  });

  it('falls back to undefined (not an error) when the wallet rejects the signature', async () => {
    signMessageAsync.mockRejectedValue(new Error('User rejected'));
    const { result } = renderHook(() => useInboxSelfAuthSignature(ADDRESS));

    await waitFor(() => expect(signMessageAsync).toHaveBeenCalledTimes(1));
    expect(result.current).toBeUndefined();
  });

  it('signs only once per address across re-renders (cached for the session)', async () => {
    signMessageAsync.mockResolvedValue('0xsignature');
    const { rerender } = renderHook(({ address }) => useInboxSelfAuthSignature(address), {
      initialProps: { address: ADDRESS as `0x${string}` | undefined },
    });

    await waitFor(() => expect(signMessageAsync).toHaveBeenCalledTimes(1));

    act(() => rerender({ address: ADDRESS }));
    act(() => rerender({ address: ADDRESS }));

    expect(signMessageAsync).toHaveBeenCalledTimes(1);
  });

  it('re-signs when the connected address changes', async () => {
    signMessageAsync.mockResolvedValue('0xsignature');
    const OTHER = '0x2222222222222222222222222222222222222222' as const;
    const { rerender } = renderHook(({ address }) => useInboxSelfAuthSignature(address), {
      initialProps: { address: ADDRESS as `0x${string}` | undefined },
    });

    await waitFor(() => expect(signMessageAsync).toHaveBeenCalledTimes(1));

    act(() => rerender({ address: OTHER }));

    await waitFor(() => expect(signMessageAsync).toHaveBeenCalledTimes(2));
    expect(signMessageAsync).toHaveBeenLastCalledWith({ message: `taskmarket:inbox:${OTHER}` });
  });
});

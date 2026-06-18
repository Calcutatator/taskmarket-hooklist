import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CreateTaskClient } from './create-task-client';

const { connectOrCreateWallet, fund, router, walletState } = vi.hoisted(() => ({
  connectOrCreateWallet: vi.fn(),
  fund: vi.fn(),
  router: {
    push: vi.fn(),
  },
  walletState: {
    address: undefined as `0x${string}` | undefined,
    isConnected: false,
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

vi.mock('wagmi', () => ({
  useAccount: () => ({
    address: walletState.address,
    isConnected: walletState.isConnected,
  }),
  useSignTypedData: () => ({ signTypedDataAsync: vi.fn() }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
}));

vi.mock('@privy-io/react-auth', () => ({
  useFiatOnramp: () => ({ fund }),
  usePrivy: () => ({
    authenticated: walletState.isConnected,
    connectOrCreateWallet,
    ready: true,
  }),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('CreateTaskClient', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = vi.fn();
    }
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_PRIVY_APP_ID', '0000000000000000000000000');
    connectOrCreateWallet.mockClear();
    fund.mockClear();
    router.push.mockClear();
    walletState.address = undefined;
    walletState.isConnected = false;
    vi.stubGlobal('fetch', vi.fn());
  });

  it('connects a wallet inline before submitting a new task', async () => {
    const user = userEvent.setup();
    render(<CreateTaskClient />);

    await user.click(screen.getByRole('button', { name: /connect wallet to post/i }));

    expect(connectOrCreateWallet).toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(screen.queryByText(/connect a wallet in the header/i)).not.toBeInTheDocument();
  });

  it('prompts users to add USDC before x402 signing when balance is too low', async () => {
    const user = userEvent.setup();
    walletState.address = '0x1234567890abcdef1234567890abcdef12345678';
    walletState.isConnected = true;
    vi.stubEnv('NEXT_PUBLIC_PRIVY_FIAT_ONBOARDING_ENABLED', 'true');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ balanceBaseUnits: '1000000', balanceUsdc: '1.000000' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CreateTaskClient />);

    await user.type(screen.getByLabelText(/description/i), 'Build a Privy funding flow.');
    await user.type(screen.getByLabelText(/^reward/i), '25');
    await user.click(screen.getByRole('button', { name: /^post a task$/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/wallet/balance?address=0x1234567890abcdef1234567890abcdef12345678'
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/tasks',
      expect.objectContaining({ method: 'POST' })
    );
    expect(screen.getByText(/wallet has 1\.000000 usdc/i)).toBeInTheDocument();
  });

  it('runs the balance pre-check even when fiat onboarding is disabled', async () => {
    const user = userEvent.setup();
    walletState.address = '0x1234567890abcdef1234567890abcdef12345678';
    walletState.isConnected = true;
    vi.stubEnv('NEXT_PUBLIC_PRIVY_FIAT_ONBOARDING_ENABLED', 'false');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ balanceBaseUnits: '1000000', balanceUsdc: '1.000000' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CreateTaskClient />);

    await user.type(screen.getByLabelText(/description/i), 'Build a Privy funding flow.');
    await user.type(screen.getByLabelText(/^reward/i), '25');
    await user.click(screen.getByRole('button', { name: /^post a task$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/wallet/balance?address=0x1234567890abcdef1234567890abcdef12345678'
      );
    });
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/tasks',
      expect.objectContaining({ method: 'POST' })
    );
    expect(screen.getByText(/wallet has 1\.000000 usdc/i)).toBeInTheDocument();
  });

  it('shows an inline field error and does not call fetch when too many tags are entered', async () => {
    const user = userEvent.setup();
    walletState.address = '0x1234567890abcdef1234567890abcdef12345678';
    walletState.isConnected = true;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<CreateTaskClient />);

    await user.type(screen.getByLabelText(/description/i), 'Build a Privy funding flow.');
    await user.type(screen.getByLabelText(/^reward/i), '25');
    const tags = Array.from({ length: 11 }, (_, index) => `tag${index}`).join(', ');
    await user.type(screen.getByLabelText(/tags/i), tags);
    await user.click(screen.getByRole('button', { name: /^post a task$/i }));

    const tagsInput = screen.getByLabelText(/tags/i);
    expect(tagsInput).toHaveAttribute('aria-invalid', 'true');
    const describedBy = tagsInput.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const inlineError = document.getElementById(describedBy as string);
    expect(inlineError).toHaveTextContent(/maximum 10 tags/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces the real server message when the probe is not a payment challenge', async () => {
    const user = userEvent.setup();
    walletState.address = '0x1234567890abcdef1234567890abcdef12345678';
    walletState.isConnected = true;
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/api/wallet/balance')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ balanceBaseUnits: '1000000000', balanceUsdc: '1000.000000' }),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Reward exceeds the maximum allowed' }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CreateTaskClient />);

    await user.type(screen.getByLabelText(/description/i), 'Build a Privy funding flow.');
    await user.type(screen.getByLabelText(/^reward/i), '25');
    await user.click(screen.getByRole('button', { name: /^post a task$/i }));

    await waitFor(() => {
      expect(screen.getByText(/reward exceeds the maximum allowed/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/got 400/i)).not.toBeInTheDocument();
  });

  it('marks required fields with a visible marker', () => {
    render(<CreateTaskClient />);

    const descriptionLabel = screen.getByText('Description').closest('label');
    expect(descriptionLabel?.textContent).toContain('*');
    const tagsLabel = screen.getByText('Tags').closest('label');
    expect(tagsLabel?.textContent).not.toContain('*');
  });

  it('toggles the require-stake checkbox', async () => {
    const user = userEvent.setup();
    render(<CreateTaskClient />);

    await user.click(screen.getByRole('radio', { name: /claim/i }));
    const checkbox = screen.getByRole('checkbox', { name: /require stake/i });
    expect(checkbox).toHaveAttribute('aria-checked', 'false');
    await user.click(checkbox);
    expect(checkbox).toHaveAttribute('aria-checked', 'true');
  });

  it('uses a mobile-safe font size on the description textarea', () => {
    render(<CreateTaskClient />);
    const description = screen.getByLabelText(/description/i);
    expect(description.className).toContain('text-base');
    expect(description.className).toContain('md:text-sm');
  });
});

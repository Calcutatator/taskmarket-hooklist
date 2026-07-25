import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { accountState, authState, connectOrCreateWallet, login, readAuthState, requestSignature } =
  vi.hoisted(() => ({
    accountState: {
      address: undefined as `0x${string}` | undefined,
      isConnected: false,
    },
    authState: {
      authenticated: false,
    },
    connectOrCreateWallet: vi.fn(),
    login: vi.fn(),
    readAuthState: {
      error: null as string | null,
      ready: false,
      status: 'idle' as 'idle' | 'signing' | 'ready' | 'error',
    },
    requestSignature: vi.fn(),
  }));

vi.mock('wagmi', () => ({
  useAccount: () => accountState,
}));

vi.mock('@privy-io/react-auth', () => ({
  usePrivy: () => ({
    authenticated: authState.authenticated,
    connectOrCreateWallet,
    login,
    logout: vi.fn(),
    ready: true,
    user: null,
  }),
  useWallets: () => ({ ready: true, wallets: [] }),
}));

vi.mock('@/lib/use-read-auth-signature', () => ({
  useReadAuthSignatureState: () => ({
    ...readAuthState,
    requestSignature,
  }),
}));

vi.mock('@/components/market/tasks', () => ({
  TaskDetailPanel: () => <div>Task detail</div>,
}));

import { PrivateTaskAccessGate } from './private-task-access-gate';

function renderGate() {
  return render(
    <PrivateTaskAccessGate
      backHref="/tasks"
      browseAgentsHref="/agents"
      browseTasksHref="/tasks"
      profileBasePath="/agents"
      taskId="private-task"
    />
  );
}

describe('PrivateTaskAccessGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_PRIVY_APP_ID', '0000000000000000000000000');
    accountState.address = undefined;
    accountState.isConnected = false;
    authState.authenticated = false;
    readAuthState.error = null;
    readAuthState.ready = false;
    readAuthState.status = 'idle';
    vi.stubGlobal('fetch', vi.fn());
  });

  it('lets an invited visitor start sign-in at the private task', async () => {
    const user = userEvent.setup();
    renderGate();

    expect(
      screen.getByText(/sign in, then choose the wallet that received the invitation/i)
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(login).toHaveBeenCalledTimes(1);
  });

  it('lets an authenticated invitee create a wallet without signing in again', async () => {
    const user = userEvent.setup();
    authState.authenticated = true;
    renderGate();

    await user.click(screen.getByRole('button', { name: /^connect wallet$/i }));

    expect(connectOrCreateWallet).toHaveBeenCalledTimes(1);
    expect(login).not.toHaveBeenCalled();
  });

  it('asks before signing and exposes retry after wallet verification fails', async () => {
    const user = userEvent.setup();
    accountState.address = '0x1111111111111111111111111111111111111111';
    accountState.isConnected = true;
    readAuthState.error = 'The wallet did not approve the verification request.';
    readAuthState.status = 'error';
    renderGate();

    expect(screen.getByText(readAuthState.error)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /retry wallet verification/i }));

    expect(requestSignature).toHaveBeenCalledTimes(1);
  });

  it('lets an invited user retry when verified access cannot be loaded', async () => {
    const user = userEvent.setup();
    accountState.address = '0x1111111111111111111111111111111111111111';
    accountState.isConnected = true;
    readAuthState.ready = true;
    readAuthState.status = 'ready';
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
    renderGate();

    const retry = await screen.findByRole('button', { name: /retry private task access/i });
    expect(screen.getByText(/could not load private task access/i)).toBeInTheDocument();
    await user.click(retry);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('removes rendered private task data when client authorization is cleared', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        json: async () => ({ grant: 'private-grant' }),
        ok: true,
      } as Response)
      .mockResolvedValueOnce({
        json: async () => ({ id: 'private-task' }),
        ok: true,
      } as Response);
    renderGate();

    await user.type(screen.getByLabelText('Password'), 'open-sesame');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText('Task detail')).toBeInTheDocument();

    act(() => window.dispatchEvent(new Event('taskmarket:auth-state-cleared')));

    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(screen.queryByText('Task detail')).not.toBeInTheDocument();
  });
});

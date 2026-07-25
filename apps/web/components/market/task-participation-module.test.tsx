import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PendingAction, TaskDetailResponse } from '@taskmarket/shared';

import { TaskParticipationModule } from './task-participation-module';

const { account, authState, connectOrCreateWallet, login } = vi.hoisted(() => ({
  account: {
    address: undefined as `0x${string}` | undefined,
    isConnected: false,
  },
  authState: {
    authenticated: false,
    providerMissing: false,
    walletAddress: undefined as `0x${string}` | undefined,
    walletsReady: true,
  },
  connectOrCreateWallet: vi.fn(),
  login: vi.fn(),
}));

vi.mock('wagmi', () => ({
  useAccount: () => account,
}));

vi.mock('@privy-io/react-auth', () => ({
  usePrivy: () => {
    if (authState.providerMissing) throw new Error('Privy provider is unavailable');
    return {
      authenticated: authState.authenticated,
      connectOrCreateWallet,
      login,
      logout: vi.fn(),
      ready: true,
      user: null,
    };
  },
  useWallets: () => {
    if (authState.providerMissing) throw new Error('Privy provider is unavailable');
    return {
      ready: authState.walletsReady,
      wallets: authState.walletAddress
        ? [{ address: authState.walletAddress, walletClientType: 'privy' }]
        : [],
    };
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/components/market/actions/submit-artifacts-form', () => ({
  SubmitArtifactsForm: () => <button type="button">Choose files</button>,
}));

const requester = '0xAaa1111111111111111111111111111111111111';
const task = {
  id: 'task-1',
  mode: 'bounty',
  requester,
  status: 'open',
} as unknown as TaskDetailResponse;
const submitAction = {
  action: 'submit',
  command: 'taskmarket task submit task-1 --file <path>',
  role: 'worker',
} as PendingAction;

describe('TaskParticipationModule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_PRIVY_APP_ID', '0000000000000000000000000');
    account.address = undefined;
    account.isConnected = false;
    authState.authenticated = false;
    authState.providerMissing = false;
    authState.walletAddress = undefined;
    authState.walletsReady = true;
  });

  it('gives a visitor truthful human and agent paths with developer commands collapsed', async () => {
    const user = userEvent.setup();

    render(<TaskParticipationModule action={submitAction} task={task} />);

    expect(screen.getByRole('heading', { level: 2, name: /want to take this on/i })).toBeVisible();
    expect(screen.getByText(/connect a wallet to upload finished work/i)).toBeVisible();
    expect(screen.getByRole('article', { name: /for humans/i })).toBeVisible();
    expect(screen.getByRole('article', { name: /for agents/i })).toBeVisible();
    const walletAccessButton = screen.getByRole('button', {
      name: /connect wallet to upload/i,
    });
    expect(walletAccessButton).toBeEnabled();
    expect(screen.queryByRole('button', { name: /upload files/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(walletAccessButton);
    expect(login).toHaveBeenCalledTimes(1);
    expect(connectOrCreateWallet).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: /set up an agent/i })).toHaveAttribute(
      'href',
      '/dashboard/for-agents?source=task-detail&taskId=task-1'
    );
    expect(screen.getByRole('link', { name: /how this works/i })).toHaveAttribute(
      'href',
      '/dashboard/task-types'
    );

    const developerDetails = screen.getByRole('group', { name: /for developers/i });
    expect(developerDetails).not.toHaveAttribute('open');

    await user.click(screen.getByText(/for developers/i));

    expect(developerDetails).toHaveAttribute('open');
    expect(
      screen.getByText(
        'curl -fsSL http://localhost:3001/install-skill.sh | sh -s -- http://localhost:3001'
      )
    ).toBeVisible();
    expect(screen.getByText('taskmarket task list --status open')).toBeVisible();
    expect(screen.getByText('taskmarket task submit task-1 --file <path>')).toBeVisible();
    expect(screen.getByRole('link', { name: /open skill\.md/i })).toHaveAttribute(
      'href',
      'http://localhost:3001/skill.md'
    );
  });

  it('opens the existing browser upload flow for a submit action', async () => {
    const user = userEvent.setup();
    account.address = '0xCcc3333333333333333333333333333333333333';
    account.isConnected = true;
    authState.authenticated = true;

    render(<TaskParticipationModule action={submitAction} task={task} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /upload files/i }));

    expect(screen.getByRole('dialog', { name: /submit work/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /choose files/i })).toBeVisible();
  });

  it('lets an authenticated worker create a wallet before uploading', async () => {
    const user = userEvent.setup();
    authState.authenticated = true;

    render(<TaskParticipationModule action={submitAction} task={task} />);

    await user.click(screen.getByRole('button', { name: /connect wallet to upload/i }));

    expect(connectOrCreateWallet).toHaveBeenCalledTimes(1);
    expect(login).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /upload files/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders an unavailable wallet action without a Privy provider', () => {
    vi.stubEnv('NEXT_PUBLIC_PRIVY_APP_ID', '');
    authState.providerMissing = true;

    render(<TaskParticipationModule action={submitAction} task={task} />);

    expect(screen.getByRole('button', { name: /sign in unavailable/i })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /upload files/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('reconnects a displayed Privy wallet before enabling upload', async () => {
    const user = userEvent.setup();
    authState.authenticated = true;
    authState.walletAddress = '0xBbb2222222222222222222222222222222222222';

    render(<TaskParticipationModule action={submitAction} task={task} />);

    expect(screen.queryByRole('button', { name: /upload files/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /connect wallet to upload/i }));

    expect(connectOrCreateWallet).toHaveBeenCalledTimes(1);
    expect(login).not.toHaveBeenCalled();
  });

  it('offers upload to the connected worker assigned to submit', () => {
    const worker = '0xBbb2222222222222222222222222222222222222';
    account.address = worker as `0x${string}`;
    account.isConnected = true;
    authState.authenticated = true;
    const assignedSubmitAction = {
      ...submitAction,
      eligibleAddress: worker,
    } as PendingAction;

    render(<TaskParticipationModule action={assignedSubmitAction} task={task} />);

    expect(screen.getByRole('button', { name: /upload files/i })).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: /connect wallet to upload/i })
    ).not.toBeInTheDocument();
  });

  it('hides participation acquisition from the task requester', () => {
    account.address = requester.toLowerCase() as `0x${string}`;
    account.isConnected = true;
    authState.authenticated = true;

    const { container } = render(<TaskParticipationModule action={submitAction} task={task} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('keeps guidance visible without exposing an assigned worker upload', () => {
    const assignedSubmitAction = {
      ...submitAction,
      eligibleAddress: '0xBbb2222222222222222222222222222222222222',
    } as PendingAction;
    const { rerender } = render(
      <TaskParticipationModule action={assignedSubmitAction} task={task} />
    );

    expect(screen.getByRole('heading', { name: /want to take this on/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /connect wallet to upload/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /upload files/i })).not.toBeInTheDocument();

    account.address = '0xCcc3333333333333333333333333333333333333';
    account.isConnected = true;
    authState.authenticated = true;
    rerender(<TaskParticipationModule action={assignedSubmitAction} task={task} />);

    expect(screen.getByRole('heading', { name: /want to take this on/i })).toBeVisible();
    expect(screen.getByText(/if you are eligible/i)).toBeVisible();
    expect(screen.queryByRole('article', { name: /for humans/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /connect wallet to upload/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /upload files/i })).not.toBeInTheDocument();
  });

  it('keeps a pre-submission task truthful without offering an immediate upload', () => {
    const claimAction = {
      action: 'claim',
      command: 'taskmarket task claim task-1',
      role: 'worker',
    } as PendingAction;

    render(<TaskParticipationModule action={claimAction} task={task} />);

    expect(screen.getByText(/use the task action on this page/i)).toBeVisible();
    expect(screen.queryByRole('article', { name: /for humans/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /upload files/i })).not.toBeInTheDocument();
    expect(screen.getByText('taskmarket task claim task-1')).toBeInTheDocument();
  });
});

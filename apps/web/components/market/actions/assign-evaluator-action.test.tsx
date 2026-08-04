import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskDetailResponse } from '@taskmarket/shared';

import {
  AssignEvaluatorAction,
  canAssignEvaluator,
  evaluatorFeeBpsOf,
} from './assign-evaluator-action';

const { payX402Post, refresh, toastError, toastInfo, toastSuccess, walletState } = vi.hoisted(
  () => ({
    payX402Post: vi.fn(),
    refresh: vi.fn(),
    toastError: vi.fn(),
    toastInfo: vi.fn(),
    toastSuccess: vi.fn(),
    walletState: {
      address: '0x1111111111111111111111111111111111111111' as `0x${string}` | undefined,
      isConnected: true,
    },
  })
);

vi.mock('wagmi', () => ({
  // Every paid action calls `useInFlightWrite`, which asks for a read-auth signature once a
  // write goes in flight so it can read the intent. Stubbed here because this file replaces
  // the whole wagmi module.
  useSignMessage: () => ({ signMessageAsync: vi.fn(async () => '0xsignature') }),
  useAccount: () => ({ address: walletState.address, isConnected: walletState.isConnected }),
  useSignTypedData: () => ({ signTypedDataAsync: vi.fn() }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock('sonner', () => ({
  toast: { error: toastError, info: toastInfo, success: toastSuccess },
}));

vi.mock('@/lib/x402-client', () => ({
  payX402Post: (...args: unknown[]) => payX402Post(...args),
}));

const requester = '0x1111111111111111111111111111111111111111';
const worker = '0x2222222222222222222222222222222222222222';
const evaluator = '0x3333333333333333333333333333333333333333';

function taskFixture(overrides: Partial<TaskDetailResponse> = {}) {
  return {
    claimedBy: null,
    disputeResolver: null,
    evaluator: null,
    id: 'task-1',
    mode: 'bounty',
    requester,
    reward: '5000000',
    status: 'open',
    ...overrides,
  } as unknown as TaskDetailResponse;
}

async function submitAppointment() {
  const user = userEvent.setup();
  await user.clear(screen.getByLabelText('Evaluator address'));
  await user.type(screen.getByLabelText('Evaluator address'), evaluator);
  await user.click(screen.getByRole('button', { name: 'Appoint evaluator' }));
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Appoint evaluator' }));
  return user;
}

describe('canAssignEvaluator', () => {
  it('allows the requester on an open, unclaimed task with no evaluator', () => {
    expect(canAssignEvaluator(taskFixture(), requester)).toBe(true);
  });

  it('is case-insensitive about the requester address', () => {
    expect(canAssignEvaluator(taskFixture(), requester.toUpperCase())).toBe(true);
  });

  it('refuses anyone who is not the requester', () => {
    expect(canAssignEvaluator(taskFixture(), worker)).toBe(false);
    expect(canAssignEvaluator(taskFixture(), null)).toBe(false);
  });

  // The contract reverts with TaskNotOpen past this point (ADR-0047), so offering the control
  // would be offering something that cannot succeed.
  it('refuses a task that has left the open status', () => {
    expect(canAssignEvaluator(taskFixture({ status: 'claimed' }), requester)).toBe(false);
  });

  it('refuses a task that is already claimed', () => {
    expect(canAssignEvaluator(taskFixture({ claimedBy: worker }), requester)).toBe(false);
  });

  it('refuses a task that already carries evaluation terms', () => {
    expect(canAssignEvaluator(taskFixture({ evaluator }), requester)).toBe(false);
    expect(canAssignEvaluator(taskFixture({ disputeResolver: worker }), requester)).toBe(false);
  });
});

describe('evaluatorFeeBpsOf', () => {
  it('converts a whole and a two-decimal percentage to basis points', () => {
    expect(evaluatorFeeBpsOf('5')).toEqual({ bps: 500 });
    expect(evaluatorFeeBpsOf('0')).toEqual({ bps: 0 });
    expect(evaluatorFeeBpsOf('100')).toEqual({ bps: 10_000 });
    expect(evaluatorFeeBpsOf(' 12.5 ')).toEqual({ bps: 1250 });
    // 1.23 * 100 is 122.99999999999999 in binary floating point; reading the decimal digits
    // rather than the product is what keeps this exact.
    expect(evaluatorFeeBpsOf('1.23')).toEqual({ bps: 123 });
  });

  it('ignores trailing zeros rather than reading them as precision', () => {
    expect(evaluatorFeeBpsOf('1.2300')).toEqual({ bps: 123 });
  });

  // The whole point: 1.235% has no basis-point representation, and rounding it to 1.24% would
  // store a fee the confirmation dialog never quoted, permanently -- no route reassigns or
  // removes an evaluator.
  it('refuses a precision finer than one basis point instead of rounding it', () => {
    const result = evaluatorFeeBpsOf('1.235');
    expect(result).toHaveProperty('error');
    expect('error' in result && result.error).toMatch(/one basis point/);
  });

  it('refuses a value outside 0 to 100 percent, and anything not a plain decimal', () => {
    expect(evaluatorFeeBpsOf('100.01')).toHaveProperty('error');
    expect(evaluatorFeeBpsOf('-1')).toHaveProperty('error');
    expect(evaluatorFeeBpsOf('')).toHaveProperty('error');
    expect(evaluatorFeeBpsOf('abc')).toHaveProperty('error');
  });
});

describe('AssignEvaluatorAction', () => {
  beforeEach(() => {
    payX402Post.mockReset();
    refresh.mockReset();
    toastError.mockReset();
    toastInfo.mockReset();
    toastSuccess.mockReset();
    walletState.address = requester;
    walletState.isConnected = true;
  });

  it('renders nothing for a viewer who cannot appoint an evaluator', () => {
    walletState.address = worker;
    const { container } = render(<AssignEvaluatorAction task={taskFixture()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('rejects a malformed evaluator address without paying anything', async () => {
    const user = userEvent.setup();
    render(<AssignEvaluatorAction task={taskFixture()} />);
    await user.type(screen.getByLabelText('Evaluator address'), 'not-an-address');
    await user.click(screen.getByRole('button', { name: 'Appoint evaluator' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Appoint evaluator' }));

    await waitFor(() =>
      expect(screen.getByText('Enter a valid 0x wallet address')).toBeInTheDocument()
    );
    expect(payX402Post).not.toHaveBeenCalled();
  });

  it('sends the fee as basis points and carries one idempotency key', async () => {
    payX402Post.mockResolvedValue({ ok: true, data: {}, idempotencyKey: 'key-1' });
    render(<AssignEvaluatorAction task={taskFixture()} />);
    await submitAppointment();

    await waitFor(() => expect(payX402Post).toHaveBeenCalled());
    const [path, body, , , idempotencyKey] = payX402Post.mock.calls[0]!;
    expect(path).toBe('/api/tasks/task-1/evaluator');
    // 5 percent, the form default, must reach the API as 500 bps rather than as 5.
    expect(body).toMatchObject({ evaluator, evaluatorFeeBps: 500 });
    expect(typeof idempotencyKey).toBe('string');
    expect(idempotencyKey).not.toHaveLength(0);
  });

  // The consent problem, end to end: the dialog quoted 1.235% while 124 bps (1.24%) went to
  // the API, and nothing on the platform can change it afterwards.
  it('refuses a fee finer than one basis point rather than rounding it away', async () => {
    const user = userEvent.setup();
    render(<AssignEvaluatorAction task={taskFixture()} />);
    await user.clear(screen.getByLabelText('Fee (%)'));
    await user.type(screen.getByLabelText('Fee (%)'), '1.235');
    await user.clear(screen.getByLabelText('Evaluator address'));
    await user.type(screen.getByLabelText('Evaluator address'), evaluator);
    await user.click(screen.getByRole('button', { name: 'Appoint evaluator' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Appoint evaluator' }));

    await waitFor(() => expect(screen.getByText(/one basis point/)).toBeInTheDocument());
    expect(payX402Post).not.toHaveBeenCalled();
  });

  it('quotes the fee it will actually send in the confirmation dialog', async () => {
    const user = userEvent.setup();
    render(<AssignEvaluatorAction task={taskFixture()} />);
    await user.clear(screen.getByLabelText('Fee (%)'));
    await user.type(screen.getByLabelText('Fee (%)'), '1.2300');
    await user.click(screen.getByRole('button', { name: 'Appoint evaluator' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/for 1\.23% of the reward/)).toBeInTheDocument();
  });

  it('omits the dispute resolver when the field is left blank', async () => {
    payX402Post.mockResolvedValue({ ok: true, data: {}, idempotencyKey: 'key-1' });
    render(<AssignEvaluatorAction task={taskFixture()} />);
    await submitAppointment();

    await waitFor(() => expect(payX402Post).toHaveBeenCalled());
    expect(payX402Post.mock.calls[0]![1]).not.toHaveProperty('disputeResolver');
  });

  // The whole point of the in-flight branch: it must claim neither outcome, and must not put
  // a retry in front of someone whose retry would be a second payment.
  it('shows an in-flight result as neither success nor failure, with no retry', async () => {
    payX402Post.mockResolvedValue({
      ok: false,
      pending: true,
      idempotencyKey: 'key-in-flight',
      error: 'it remains in flight',
    });
    render(<AssignEvaluatorAction task={taskFixture()} />);
    await submitAppointment();

    await waitFor(() =>
      expect(screen.getByText('Appointment submitted, confirming')).toBeInTheDocument()
    );
    expect(screen.getByText(/not a success and not a failure/)).toBeInTheDocument();
    expect(screen.getByText(/key-in-flight/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(toastError).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('reports an ordinary failure as a failure', async () => {
    payX402Post.mockResolvedValue({ ok: false, error: 'Task is not open' });
    render(<AssignEvaluatorAction task={taskFixture()} />);
    await submitAppointment();

    await waitFor(() => expect(screen.getByText('Task is not open')).toBeInTheDocument());
    expect(toastError).toHaveBeenCalledWith('Task is not open');
    expect(screen.queryByText('Appointment submitted, confirming')).toBeNull();
  });

  it('stays silent when the user cancels in their wallet', async () => {
    payX402Post.mockResolvedValue({ ok: false, error: 'Cancelled in wallet', rejected: true });
    render(<AssignEvaluatorAction task={taskFixture()} />);
    await submitAppointment();

    await waitFor(() => expect(payX402Post).toHaveBeenCalled());
    expect(toastError).not.toHaveBeenCalled();
    expect(screen.queryByText('Cancelled in wallet')).toBeNull();
  });

  it('reuses the same idempotency key across two submissions from one form', async () => {
    payX402Post.mockResolvedValue({ ok: false, error: 'Temporary glitch' });
    render(<AssignEvaluatorAction task={taskFixture()} />);
    await submitAppointment();
    await waitFor(() => expect(payX402Post).toHaveBeenCalledTimes(1));
    await submitAppointment();
    await waitFor(() => expect(payX402Post).toHaveBeenCalledTimes(2));

    expect(payX402Post.mock.calls[0]![4]).toBe(payX402Post.mock.calls[1]![4]);
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PendingAction, TaskDetailResponse } from '@taskmarket/shared';

import {
  AppealButton,
  EvaluateButton,
  FinalizeVerdictButton,
  ResolveDisputeButton,
} from './evaluator-actions';

const { fetchMock, invalidateActionQueue, payX402Post, toastError, toastSuccess } = vi.hoisted(
  () => ({
    fetchMock: vi.fn(),
    invalidateActionQueue: vi.fn(),
    payX402Post: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
  })
);

vi.mock('wagmi', () => ({
  useAccount: () => ({
    address: '0x1111111111111111111111111111111111111111',
    isConnected: true,
  }),
  useSignTypedData: () => ({ signTypedDataAsync: vi.fn() }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: { error: toastError, success: toastSuccess },
}));

vi.mock('@/lib/x402-client', () => ({
  payX402Post: (...args: unknown[]) => payX402Post(...args),
}));

vi.mock('@/lib/use-action-queue', () => ({
  useInvalidateActionQueue: () => invalidateActionQueue,
}));

vi.mock('@/lib/legal-receipt', () => ({
  getLegalRequestHeaders: vi.fn().mockResolvedValue({}),
}));

const worker = '0x2222222222222222222222222222222222222222';
const task = {
  id: 'task-1',
  requester: '0x3333333333333333333333333333333333333333',
  evaluator: '0x1111111111111111111111111111111111111111',
  disputeResolver: '0x1111111111111111111111111111111111111111',
  claimedBy: worker,
  reward: '5000000',
  evaluatorFeeBps: 500,
  mode: 'claim',
} as unknown as TaskDetailResponse;

function action(name: PendingAction['action']) {
  return { action: name, role: 'worker', command: `tm ${name}` } as PendingAction;
}

describe('evaluator task actions', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    invalidateActionQueue.mockReset();
    invalidateActionQueue.mockResolvedValue(undefined);
    payX402Post.mockReset();
    toastError.mockReset();
    toastSuccess.mockReset();
  });

  it('appeals through X402 and clears the completed queue action', async () => {
    payX402Post.mockResolvedValue({ ok: true, data: {}, txHash: '0xappeal' });
    const onSuccess = vi.fn();
    const user = userEvent.setup();

    render(
      <AppealButton action={action('appeal')} disabled={false} onSuccess={onSuccess} task={task} />
    );
    await user.click(screen.getByRole('button', { name: /appeal verdict/i }));
    const buttons = await screen.findAllByRole('button', { name: /appeal verdict/i });
    await user.click(buttons.at(-1)!);

    await waitFor(() => expect(payX402Post).toHaveBeenCalledTimes(1));
    expect(payX402Post.mock.calls[0]?.slice(0, 2)).toEqual([
      '/api/tasks/task-1/appeal',
      { taskId: 'task-1' },
    ]);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(invalidateActionQueue).toHaveBeenCalledTimes(1);
  });

  it('announces a failed appeal without reporting success', async () => {
    payX402Post.mockResolvedValue({ ok: false, error: 'Appeal window has closed' });
    const user = userEvent.setup();
    render(<AppealButton action={action('appeal')} disabled={false} task={task} />);

    await user.click(screen.getByRole('button', { name: /appeal verdict/i }));
    const buttons = await screen.findAllByRole('button', { name: /appeal verdict/i });
    await user.click(buttons.at(-1)!);

    expect(await screen.findByRole('alert')).toHaveTextContent('Appeal window has closed');
    expect(invalidateActionQueue).not.toHaveBeenCalled();
  });

  it('submits a validated evaluator verdict and award in base units', async () => {
    payX402Post.mockResolvedValue({ ok: true, data: {}, txHash: '0xevaluate' });
    const user = userEvent.setup();

    render(
      <EvaluateButton
        action={action('evaluate')}
        disabled={false}
        task={task}
        onSuccess={vi.fn()}
      />
    );

    await user.clear(screen.getByLabelText(/award amount/i));
    await user.type(screen.getByLabelText(/award amount/i), '4.75');
    await user.type(screen.getByLabelText(/evidence hash/i), `0x${'a'.repeat(64)}`);
    await user.click(screen.getByRole('button', { name: /submit evaluation/i }));
    const submitButtons = await screen.findAllByRole('button', { name: /submit evaluation/i });
    await user.click(submitButtons.at(-1)!);

    await waitFor(() => expect(payX402Post).toHaveBeenCalledTimes(1));
    expect(payX402Post.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        taskId: 'task-1',
        verdict: 'approve',
        score: 1000,
        confidence: 1000,
        evidenceHash: `0x${'a'.repeat(64)}`,
        awards: [{ worker, amount: '4750000', rank: 1 }],
      })
    );
  });

  it('blocks duplicate award recipients before dispute settlement', async () => {
    const user = userEvent.setup();
    render(
      <ResolveDisputeButton action={action('resolve_dispute')} disabled={false} task={task} />
    );

    await user.click(screen.getByRole('button', { name: /add recipient/i }));
    const workerInputs = screen.getAllByLabelText(/worker address/i);
    await user.type(workerInputs[1]!, worker);
    const amountInputs = screen.getAllByLabelText(/award amount/i);
    await user.type(amountInputs[1]!, '0.1');
    await user.click(screen.getByRole('button', { name: /resolve dispute/i }));
    const resolveButtons = await screen.findAllByRole('button', { name: /resolve dispute/i });
    await user.click(resolveButtons.at(-1)!);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/each award recipient must be unique/i);
    expect(alert.closest('fieldset')).toHaveAttribute('aria-invalid', 'true');
    expect(payX402Post).not.toHaveBeenCalled();
  });

  it('requires non-zero evaluation evidence before payment', async () => {
    const user = userEvent.setup();
    render(<EvaluateButton action={action('evaluate')} disabled={false} task={task} />);

    await user.click(screen.getByRole('button', { name: /submit evaluation/i }));
    const submitButtons = await screen.findAllByRole('button', { name: /submit evaluation/i });
    await user.click(submitButtons.at(-1)!);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/evidence hash is required/i);
    expect(screen.getByLabelText(/evidence hash/i)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/evidence hash/i)).toHaveAttribute('aria-describedby', alert.id);
    expect(screen.getByLabelText(/score/i)).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText(/score/i)).not.toHaveAttribute('aria-describedby');
    expect(screen.getByLabelText(/confidence/i)).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText(/confidence/i)).not.toHaveAttribute('aria-describedby');
    expect(payX402Post).not.toHaveBeenCalled();
  });

  it('announces backend evaluation errors at form level without invalidating fields', async () => {
    payX402Post.mockResolvedValue({ ok: false, error: 'Action is no longer available' });
    const user = userEvent.setup();
    render(<EvaluateButton action={action('evaluate')} disabled={false} task={task} />);

    await user.type(screen.getByLabelText(/evidence hash/i), `0x${'a'.repeat(64)}`);
    await user.click(screen.getByRole('button', { name: /submit evaluation/i }));
    const submitButtons = await screen.findAllByRole('button', { name: /submit evaluation/i });
    await user.click(submitButtons.at(-1)!);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/action is no longer available/i);
    expect(screen.getByLabelText(/score/i)).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText(/confidence/i)).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText(/evidence hash/i)).not.toHaveAttribute('aria-invalid');
  });

  it('finalizes a verdict without an X402 payment and refreshes the queue', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ txHash: '0xfinal' }),
    });
    const onSuccess = vi.fn();
    const user = userEvent.setup();

    render(
      <FinalizeVerdictButton
        action={action('finalize_verdict')}
        disabled={false}
        onSuccess={onSuccess}
        task={task}
      />
    );
    await user.click(screen.getByRole('button', { name: /finalize verdict/i }));
    const finalizeButtons = await screen.findAllByRole('button', { name: /finalize verdict/i });
    await user.click(finalizeButtons.at(-1)!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/tasks/task-1/finalize-verdict');
    expect(payX402Post).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(invalidateActionQueue).toHaveBeenCalledTimes(1);
  });

  it('announces a failed verdict finalization', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({ message: 'Appeal window remains open' }),
      status: 409,
    });
    const user = userEvent.setup();
    render(
      <FinalizeVerdictButton action={action('finalize_verdict')} disabled={false} task={task} />
    );

    await user.click(screen.getByRole('button', { name: /finalize verdict/i }));
    const buttons = await screen.findAllByRole('button', { name: /finalize verdict/i });
    await user.click(buttons.at(-1)!);

    expect(await screen.findByRole('alert')).toHaveTextContent('Appeal window remains open');
    expect(invalidateActionQueue).not.toHaveBeenCalled();
  });
});

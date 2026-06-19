import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CreateTaskWizard } from './create-task-wizard';

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

const VALID_BRIEF = 'Build a Privy funding flow with clear acceptance criteria.';

// Step 1 (Template) -> select Custom and open the Brief step.
async function gotoBriefFromCustom(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /write the brief/i }));
}

// Fill the required Brief fields so step-2 validation passes.
async function fillBrief(
  user: ReturnType<typeof userEvent.setup>,
  { description = VALID_BRIEF, reward = '25' }: { description?: string; reward?: string } = {}
) {
  await user.type(screen.getByLabelText(/description/i), description);
  await user.type(screen.getByLabelText(/^reward/i), reward);
}

// Step 2 (Brief) -> Step 3 (Publish).
async function continueToPublish(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /continue to publish/i }));
}

// Full path Template (custom) -> Brief (filled) -> Publish.
async function gotoPublishFromCustom(
  user: ReturnType<typeof userEvent.setup>,
  briefOptions?: { description?: string; reward?: string }
) {
  await gotoBriefFromCustom(user);
  await fillBrief(user, briefOptions);
  await continueToPublish(user);
}

describe('CreateTaskWizard', () => {
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
    render(<CreateTaskWizard initialMarketStats={null} />);

    await gotoPublishFromCustom(user);

    await user.click(screen.getByRole('button', { name: /connect wallet to post/i }));

    expect(connectOrCreateWallet).toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
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

    render(<CreateTaskWizard initialMarketStats={null} />);

    await gotoPublishFromCustom(user);
    await user.click(screen.getByRole('button', { name: /^fund and publish$/i }));

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

    render(<CreateTaskWizard initialMarketStats={null} />);

    await gotoPublishFromCustom(user);
    await user.click(screen.getByRole('button', { name: /^fund and publish$/i }));

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

    render(<CreateTaskWizard initialMarketStats={null} />);

    await gotoBriefFromCustom(user);
    await fillBrief(user);
    const tags = Array.from({ length: 11 }, (_, index) => `tag${index}`).join(', ');
    await user.type(screen.getByLabelText(/tags/i), tags);
    await continueToPublish(user);

    const tagsInput = screen.getByLabelText(/tags/i);
    expect(tagsInput).toHaveAttribute('aria-invalid', 'true');
    const describedBy = tagsInput.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const inlineError = document.getElementById(describedBy as string);
    expect(inlineError).toHaveTextContent(/maximum 10 tags/i);
    // Still on the Brief step, no network call made.
    expect(screen.getByRole('button', { name: /continue to publish/i })).toBeInTheDocument();
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

    render(<CreateTaskWizard initialMarketStats={null} />);

    await gotoPublishFromCustom(user);
    await user.click(screen.getByRole('button', { name: /^fund and publish$/i }));

    await waitFor(() => {
      expect(screen.getByText(/reward exceeds the maximum allowed/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/got 400/i)).not.toBeInTheDocument();
  });

  it('marks required fields with a visible marker', async () => {
    const user = userEvent.setup();
    render(<CreateTaskWizard initialMarketStats={null} />);

    await gotoBriefFromCustom(user);

    const descriptionLabel = screen.getByText('Description').closest('label');
    expect(descriptionLabel?.textContent).toContain('*');
    const tagsLabel = screen.getByText('Tags').closest('label');
    expect(tagsLabel?.textContent).not.toContain('*');
  });

  it('toggles the require-stake checkbox', async () => {
    const user = userEvent.setup();
    render(<CreateTaskWizard initialMarketStats={null} />);

    await gotoBriefFromCustom(user);
    // Open the Mode & advanced disclosure, then pick the Claim mode.
    await user.click(screen.getByRole('button', { name: /^show$/i }));
    await user.click(screen.getByRole('radio', { name: /claim/i }));

    const checkbox = screen.getByRole('checkbox', { name: /require stake/i });
    expect(checkbox).toHaveAttribute('aria-checked', 'false');
    await user.click(checkbox);
    expect(checkbox).toHaveAttribute('aria-checked', 'true');
  });

  it('uses a mobile-safe font size on the description textarea', async () => {
    const user = userEvent.setup();
    render(<CreateTaskWizard initialMarketStats={null} />);

    await gotoBriefFromCustom(user);

    const description = screen.getByLabelText(/description/i);
    expect(description.className).toContain('text-base');
    expect(description.className).toContain('md:text-sm');
  });

  it('pre-fills the description and reward when the Logo template is selected', async () => {
    const user = userEvent.setup();
    render(<CreateTaskWizard initialMarketStats={null} />);

    await user.click(screen.getByRole('radio', { name: /logo/i }));
    await user.click(screen.getByRole('button', { name: /customize brief/i }));

    const description = screen.getByLabelText(/description/i) as HTMLTextAreaElement;
    expect(description.value).toContain('primary logo');
    const reward = screen.getByLabelText(/^reward/i) as HTMLInputElement;
    expect(reward.value).toBe('2');
  });

  it('lands on the Publish step with a complete summary via "Use this and publish"', async () => {
    const user = userEvent.setup();
    render(<CreateTaskWizard initialMarketStats={null} />);

    await user.click(screen.getByRole('radio', { name: /logo/i }));
    await user.click(screen.getByRole('button', { name: /use this and publish/i }));

    expect(await screen.findByRole('heading', { name: /review and publish/i })).toBeInTheDocument();
    // The review summary carries the Logo template badge and the composed brief.
    expect(screen.getByText('Logo')).toBeInTheDocument();
    expect(screen.getByText(/primary logo/i, { exact: false })).toBeInTheDocument();
  });

  it('keeps the step 1 primary CTA available because a template is always selected', () => {
    render(<CreateTaskWizard initialMarketStats={null} />);

    // Default template is custom, so its primary CTA is "Write the brief".
    const cta = screen.getByRole('button', { name: /write the brief/i });
    expect(cta).toBeEnabled();
  });

  it('preserves edited brief values across back-navigation (Brief -> Template -> Brief)', async () => {
    const user = userEvent.setup();
    render(<CreateTaskWizard initialMarketStats={null} />);

    await gotoBriefFromCustom(user);
    await user.type(screen.getByLabelText(/description/i), 'A bespoke brief I typed.');
    await user.type(screen.getByLabelText(/^reward/i), '42');

    // Back to Template via the context strip, then return to the Brief step.
    await user.click(screen.getByRole('button', { name: /change template/i }));
    await user.click(await screen.findByRole('button', { name: /write the brief/i }));

    const description = screen.getByLabelText(/description/i) as HTMLTextAreaElement;
    expect(description.value).toBe('A bespoke brief I typed.');
    const reward = screen.getByLabelText(/^reward/i) as HTMLInputElement;
    expect(reward.value).toBe('42');
  });

  it('prompts before overwriting edits when a different template is chosen', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<CreateTaskWizard initialMarketStats={null} />);

    await gotoBriefFromCustom(user);
    await user.type(screen.getByLabelText(/description/i), 'Edited brief that should be guarded.');

    // Go back to the gallery and pick a different (Logo) template.
    await user.click(screen.getByRole('button', { name: /change template/i }));
    await user.click(await screen.findByRole('radio', { name: /logo/i }));

    expect(confirmSpy).toHaveBeenCalled();
    // Declined the confirm, so the edited brief survives.
    await user.click(screen.getByRole('button', { name: /write the brief/i }));
    const description = screen.getByLabelText(/description/i) as HTMLTextAreaElement;
    expect(description.value).toBe('Edited brief that should be guarded.');

    confirmSpy.mockRestore();
  });

  it('shows the cost breakdown on the Publish review (reward, 5% fee, worker receives)', async () => {
    const user = userEvent.setup();
    render(<CreateTaskWizard initialMarketStats={null} />);

    await gotoPublishFromCustom(user, { reward: '100' });

    const breakdownLabel = screen.getByText(/cost breakdown/i);
    const breakdown = breakdownLabel.closest('div') as HTMLElement;
    // Scope to the definition-list term rows so the trailing explanatory
    // paragraph (which also says "You escrow") does not collide with these.
    const labels = within(breakdown)
      .getAllByRole('term')
      .map((row) => row.textContent);
    expect(labels).toContain('You escrow');
    expect(labels).toContain('Platform fee (5%)');
    expect(labels).toContain('Worker receives');
    // 100 reward -> 5 fee -> 95 to worker.
    expect(within(breakdown).getByText('100.000 USDC')).toBeInTheDocument();
    expect(within(breakdown).getByText('5.000 USDC')).toBeInTheDocument();
    expect(within(breakdown).getByText('95.000 USDC')).toBeInTheDocument();
  });

  it('renders fully when initialMarketStats is null without a market strip', async () => {
    const user = userEvent.setup();
    render(<CreateTaskWizard initialMarketStats={null} />);

    // Template gallery renders, no labour-market strip when stats are absent.
    expect(screen.getByRole('radio', { name: /logo/i })).toBeInTheDocument();
    expect(screen.queryByText(/labour market/i)).not.toBeInTheDocument();

    // The flow still works end to end through to Publish.
    await gotoPublishFromCustom(user);
    expect(await screen.findByRole('heading', { name: /review and publish/i })).toBeInTheDocument();
  });
});

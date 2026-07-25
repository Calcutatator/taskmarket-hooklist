import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TRY_DROPS } from '@/lib/try/drops';
import { TRY_FUNNEL_EVENT_NAME, type TryFunnelEvent } from '@/lib/try/events';

import { TryExperience } from './try-experience';
import { TryFlow } from './try-flow';

const { router, walletState } = vi.hoisted(() => ({
  router: { push: vi.fn() },
  walletState: {
    address: undefined as `0x${string}` | undefined,
    isConnected: false,
  },
}));

const PAYMENT_TERMS = {
  accepts: [
    {
      amount: '1000000',
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      extra: {
        eip712: {
          domain: {
            chainId: 8453,
            name: 'USD Coin',
            verifyingContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            version: '2',
          },
          types: { TransferWithAuthorization: [] },
        },
      },
      maxTimeoutSeconds: 300,
      network: 'eip155:8453',
      payTo: '0x1111111111111111111111111111111111111111',
      scheme: 'exact',
    },
  ],
};

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

vi.mock('@/lib/api/client', () => ({
  trpc: {
    wallet: {
      exchangeRate: { useQuery: () => ({ data: undefined, isLoading: false }) },
    },
  },
}));

vi.mock('wagmi', () => ({
  useAccount: () => walletState,
  useSignTypedData: () => ({ signTypedDataAsync: vi.fn() }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
}));

vi.mock('@privy-io/react-auth', () => ({
  useFiatOnramp: () => ({ fund: vi.fn() }),
  usePrivy: () => ({
    authenticated: walletState.isConnected,
    connectOrCreateWallet: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    ready: true,
    user: null,
  }),
  useWallets: () => ({ ready: true, wallets: [] }),
}));

class IntersectionObserverStub {
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }

  disconnect() {}

  observe(target: Element) {
    this.callback(
      [
        {
          boundingClientRect: target.getBoundingClientRect(),
          intersectionRatio: 1,
          intersectionRect: target.getBoundingClientRect(),
          isIntersecting: true,
          rootBounds: null,
          target,
          time: 0,
        },
      ],
      this as unknown as IntersectionObserver
    );
  }

  takeRecords() {
    return [];
  }

  unobserve() {}
}

describe('TryExperience', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_PRIVY_APP_ID', '0000000000000000000000000');
    vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);
    HTMLElement.prototype.scrollIntoView = vi.fn();
    walletState.address = undefined;
    walletState.isConnected = false;
    router.push.mockClear();
    window.sessionStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('remains usable when session storage is unavailable', async () => {
    const user = userEvent.setup();
    const error = new DOMException('Storage is unavailable', 'SecurityError');
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw error;
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw error;
    });
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw error;
    });

    try {
      expect(() => render(<TryExperience drops={TRY_DROPS} />)).not.toThrow();
      const heroPrompt = screen.getAllByLabelText(/what should yours explain/i)[0]!;
      await user.type(heroPrompt, 'How storage fallbacks keep creation reliable');
      expect(heroPrompt).toHaveValue('How storage fallbacks keep creation reliable');
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
      removeItem.mockRestore();
    }
  });

  it('renders the proof-first offer and rejects an empty topic inline', async () => {
    const user = userEvent.setup();
    render(<TryExperience drops={TRY_DROPS} />);

    expect(
      screen.getByRole('heading', { name: 'A custom infographic for $1.' })
    ).toBeInTheDocument();
    expect(screen.getByText('Made on Taskmarket')).toBeInTheDocument();
    expect(screen.getByText(/no account needed to start/i)).toBeInTheDocument();
    expect(screen.getByText('$0.925')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: /build my brief/i })[0]!);

    expect(screen.getAllByText(/enter a topic before building your brief/i)).toHaveLength(1);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getAllByLabelText(/what should yours explain/i)[0]).toHaveFocus();
  });

  it('keeps both prompts synchronized, seeds the builder, and focuses the next answer', async () => {
    const user = userEvent.setup();
    render(<TryExperience drops={TRY_DROPS} />);
    const [heroPrompt, closingPrompt] = screen.getAllByLabelText(/what should yours explain/i);

    await user.type(heroPrompt!, 'Why solar power keeps getting cheaper');
    expect(closingPrompt).toHaveValue('Why solar power keeps getting cheaper');
    await user.click(screen.getAllByRole('button', { name: /build my brief/i })[0]!);

    await waitFor(() =>
      expect(screen.getByLabelText(/infographic topic/i)).toHaveValue(
        'Why solar power keeps getting cheaper'
      )
    );
    await waitFor(() => expect(screen.getByLabelText(/target audience/i)).toHaveFocus());
  });

  it('restores the topic after a mobile authentication handoff reloads the page', async () => {
    const user = userEvent.setup();
    const firstRender = render(<TryExperience drops={TRY_DROPS} />);

    await user.type(
      screen.getAllByLabelText(/what should yours explain/i)[0]!,
      'How public goods funding works'
    );
    firstRender.unmount();

    render(<TryExperience drops={TRY_DROPS} />);

    await waitFor(() => {
      expect(screen.getAllByLabelText(/what should yours explain/i)[0]).toHaveValue(
        'How public goods funding works'
      );
    });
  });

  it('confirms before replacing a dirty draft and lets proof actions populate only the prompt', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<TryExperience drops={TRY_DROPS} />);
    const heroPrompt = screen.getAllByLabelText(/what should yours explain/i)[0]!;

    await user.type(heroPrompt, 'The first topic');
    await user.click(screen.getAllByRole('button', { name: /build my brief/i })[0]!);
    await user.type(await screen.findByLabelText(/target audience/i), 'policy teams');

    await user.clear(heroPrompt);
    await user.type(heroPrompt, 'A replacement topic');
    await user.click(screen.getAllByRole('button', { name: /build my brief/i })[0]!);

    expect(confirmSpy).toHaveBeenCalledWith(
      'This will replace the brief you have started. Continue with the new topic?'
    );
    expect(screen.getByLabelText(/infographic topic/i)).toHaveValue('The first topic');

    await user.click(screen.getAllByRole('button', { name: /start from this idea/i })[0]!);
    expect(
      screen.getByLabelText('What should yours explain?', { selector: '#try-topic-closing' })
    ).toHaveValue(TRY_DROPS[0]!.shortTopic);
    expect(screen.getByLabelText(/infographic topic/i)).toHaveValue('The first topic');
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  it('emits vendor-neutral events without including the free-text topic', async () => {
    const user = userEvent.setup();
    const events: TryFunnelEvent[] = [];
    const listener = (event: Event) => {
      events.push((event as CustomEvent<TryFunnelEvent>).detail);
    };
    window.addEventListener(TRY_FUNNEL_EVENT_NAME, listener);

    render(<TryExperience drops={TRY_DROPS} />);
    const secretTopic = 'Private quarterly strategy for customer 4821';
    await user.type(screen.getAllByLabelText(/what should yours explain/i)[0]!, secretTopic);
    await user.click(screen.getAllByRole('button', { name: /build my brief/i })[0]!);
    await user.type(await screen.findByLabelText(/target audience/i), 'finance teams');
    await user.click(screen.getByRole('button', { name: /review and fund/i }));
    const connectButton = await screen.findByRole('button', { name: /sign in to fund \$1/i });
    await waitFor(() => expect(connectButton).toBeEnabled());
    await user.click(connectButton);
    await user.click(screen.getAllByRole('button', { name: /start from this idea/i })[0]!);

    expect(events.map((event) => event.name)).toEqual(
      expect.arrayContaining([
        'try_brief_completed',
        'try_view',
        'try_builder_viewed',
        'try_connect_started',
        'try_drop_remix',
        'try_publish_viewed',
        'try_topic_started',
        'try_topic_submitted',
      ])
    );
    expect(JSON.stringify(events)).not.toContain(secretTopic);

    window.removeEventListener(TRY_FUNNEL_EVENT_NAME, listener);
  });

  it('finishes publication when try-draft cleanup is blocked', async () => {
    const user = userEvent.setup();
    const events: TryFunnelEvent[] = [];
    const listener = (event: Event) => {
      events.push((event as CustomEvent<TryFunnelEvent>).detail);
    };
    window.addEventListener(TRY_FUNNEL_EVENT_NAME, listener);
    walletState.address = '0x1234567890abcdef1234567890abcdef12345678';
    walletState.isConnected = true;
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Storage is unavailable', 'SecurityError');
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ balanceBaseUnits: '1000000', balanceUsdc: '1.000000' }),
      })
      .mockResolvedValueOnce({
        json: async () => PAYMENT_TERMS,
        ok: false,
        status: 402,
      })
      .mockResolvedValueOnce({
        json: async () => ({ taskId: '0xtry-published' }),
        ok: true,
      });
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<TryExperience drops={TRY_DROPS} />);
      await user.type(
        screen.getAllByLabelText(/what should yours explain/i)[0]!,
        'How resilient browser storage works'
      );
      await user.click(screen.getAllByRole('button', { name: /build my brief/i })[0]!);
      await user.type(await screen.findByLabelText(/target audience/i), 'web developers');
      await user.click(screen.getByRole('button', { name: /review and fund/i }));
      await user.click(screen.getByRole('button', { name: /fund \$1 and publish/i }));

      await waitFor(() =>
        expect(router.push).toHaveBeenCalledWith('/dashboard/tasks/0xtry-published?published=1')
      );
      expect(router.push).toHaveBeenCalledTimes(1);
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'try_task_published', source: 'wizard' }),
        ])
      );
      expect(
        fetchMock.mock.calls.filter(
          ([url, init]) =>
            url === '/api/tasks' &&
            typeof init === 'object' &&
            init !== null &&
            'payment-signature' in ((init as RequestInit).headers as Record<string, string>)
        )
      ).toHaveLength(1);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally {
      removeItem.mockRestore();
      window.removeEventListener(TRY_FUNNEL_EVENT_NAME, listener);
    }
  });

  it('renders the explanatory drop flow as a static end state under reduced motion', () => {
    const { container } = render(<TryFlow drops={TRY_DROPS} />);

    expect(container.querySelector('[data-motion="static"]')).toBeInTheDocument();
    expect(container.querySelectorAll('img')).toHaveLength(4);
  });
});

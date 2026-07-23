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
  usePrivy: () => ({ connectOrCreateWallet: vi.fn(), ready: true }),
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
    const connectButton = await screen.findByRole('button', { name: /connect to fund \$1/i });
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

  it('renders the explanatory drop flow as a static end state under reduced motion', () => {
    const { container } = render(<TryFlow drops={TRY_DROPS} />);

    expect(container.querySelector('[data-motion="static"]')).toBeInTheDocument();
    expect(container.querySelectorAll('img')).toHaveLength(4);
  });
});

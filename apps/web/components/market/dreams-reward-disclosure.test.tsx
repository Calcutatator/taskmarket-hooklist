import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { DreamsRewardDisclosure } from './dreams-reward-disclosure';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

describe('DreamsRewardDisclosure', () => {
  it('explains that an estimated DREAMS bonus depends on eligibility rules', async () => {
    const user = userEvent.setup();
    render(<DreamsRewardDisclosure />);

    const trigger = screen.getByRole('button', {
      name: /learn how dreams bonus eligibility works/i,
    });

    await user.hover(trigger);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      /estimated, not guaranteed.*wallet age.*weekly reward caps.*zero/i
    );

    await user.click(trigger);
    const details = await screen.findByRole('dialog');

    expect(details).toHaveTextContent(
      /wallet age starts with the recipient's first interaction with the dreams reward hook, not when the wallet was created/i
    );
    expect(details).toHaveTextContent(/under 2 weeks.*0%/i);
    expect(details).toHaveTextContent(/2–4 weeks.*25%/i);
    expect(details).toHaveTextContent(/4–8 weeks.*50%/i);
    expect(details).toHaveTextContent(/8\+ weeks.*100%/i);
    expect(details).toHaveTextContent(/weekly.*caps.*reduce or skip/i);
    expect(details).toHaveTextContent(/bounty.*rate.*completion/i);
    expect(details).toHaveTextContent(/usdc.*unaffected/i);
    expect(details).toHaveTextContent(/claimable.*not sent automatically/i);
    expect(
      screen.getByRole('link', {
        name: /read the dreams reward rules/i,
      })
    ).toHaveAttribute('href', 'https://docs.taskmarket.dev/reference/rewards');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    trigger.focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/estimated, not guaranteed/i);
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();

    await user.keyboard(' ');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(document.body);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

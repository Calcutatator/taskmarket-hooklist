import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TryHeader } from './try-chrome';

const { login, privyState } = vi.hoisted(() => ({
  login: vi.fn(),
  privyState: {
    authenticated: false,
    ready: true,
  },
}));

vi.mock('@privy-io/react-auth', () => ({
  usePrivy: () => ({
    authenticated: privyState.authenticated,
    login,
    ready: privyState.ready,
  }),
}));

describe('TryHeader', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_PRIVY_APP_ID', '0000000000000000000000000');
    login.mockClear();
    privyState.authenticated = false;
    privyState.ready = true;
  });

  it('signs in without navigating away from the campaign draft', async () => {
    const user = userEvent.setup();
    render(<TryHeader />);

    const signIn = screen.getByRole('button', { name: /sign in/i });
    expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument();

    await user.click(signIn);

    expect(login).toHaveBeenCalledOnce();
  });

  it('returns authenticated users to the infographic builder', () => {
    privyState.authenticated = true;
    render(<TryHeader />);

    expect(screen.getByRole('link', { name: /continue brief/i })).toHaveAttribute(
      'href',
      '#try-builder'
    );
  });
});

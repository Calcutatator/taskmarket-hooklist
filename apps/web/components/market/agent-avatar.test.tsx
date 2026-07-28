import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AgentAvatar } from './agent-avatar';

describe('AgentAvatar', () => {
  it('keeps one named image and a visible deterministic fallback before canvas paint', () => {
    render(<AgentAvatar address="0xab1234567890abcdef1234567890abcdef123456" size="sm" />);

    expect(screen.getByRole('img', { name: /avatar for 0xab1234/i })).toBeVisible();
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.getByText('AB')).toBeVisible();
  });

  it('uses the resolved agent identity for its accessible name', () => {
    render(
      <AgentAvatar
        address="0xcd1234567890abcdef1234567890abcdef123456"
        agentId="unregistered-test-agent"
      />
    );

    expect(
      screen.getByRole('img', { name: 'Avatar for Agent #unregistered-test-agent' })
    ).toBeVisible();
  });
});

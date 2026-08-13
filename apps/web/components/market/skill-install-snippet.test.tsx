import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SkillInstallSnippet } from './skill-install-snippet';

const commands = {
  curl: 'curl -fsSL https://taskmarket.dev/install-skill.sh | sh',
  npx: 'npx skills add https://github.com/daydreamsai/skills-market --skill taskmarket',
} as const;

describe('SkillInstallSnippet', () => {
  it('switches install methods and copies the selected command', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

    render(<SkillInstallSnippet commands={commands} />);

    expect(screen.getByRole('button', { name: /^npx$/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(commands.npx)).toBeVisible();
    expect(screen.getByLabelText('Skill install command')).toHaveAttribute('tabindex', '0');

    await user.click(screen.getByRole('button', { name: /^curl$/i }));

    expect(screen.getByRole('button', { name: /^curl$/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(commands.curl)).toBeVisible();

    await user.click(screen.getByRole('button', { name: /copy curl skill install command/i }));
    expect(writeText).toHaveBeenLastCalledWith(commands.curl);
  });

  it('can default to curl for attribution-aware install surfaces', () => {
    render(<SkillInstallSnippet commands={commands} defaultMethod="curl" />);

    expect(screen.getByRole('button', { name: /^curl$/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(commands.curl)).toBeVisible();
  });

  it('supports keyboard selection of an install method', async () => {
    const user = userEvent.setup();

    render(<SkillInstallSnippet commands={commands} />);

    screen.getByRole('button', { name: /^curl$/i }).focus();
    await user.keyboard('{Enter}');

    expect(screen.getByRole('button', { name: /^curl$/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(commands.curl)).toBeVisible();
  });
});

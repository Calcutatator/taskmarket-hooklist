import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CopyButton, CopyCommand } from './copy-button';

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    writable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CopyButton', () => {
  it('renders with default aria-label', () => {
    render(<CopyButton text="hello" />);
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('accepts custom aria-label', () => {
    render(<CopyButton text="hello" aria-label="Copy address" />);
    expect(screen.getByRole('button', { name: 'Copy address' })).toBeInTheDocument();
  });
});

describe('CopyCommand', () => {
  it('renders the command text in a code block', () => {
    render(<CopyCommand command="npm install" />);
    expect(screen.getByText('npm install')).toBeInTheDocument();
  });

  it('renders role prefix when provided', () => {
    render(<CopyCommand command="cmd" role="worker" />);
    expect(screen.getByText('[worker]')).toBeInTheDocument();
  });

  it('does not render role prefix when omitted', () => {
    const { container } = render(<CopyCommand command="cmd" />);
    expect(container.textContent).not.toContain('[');
  });
});

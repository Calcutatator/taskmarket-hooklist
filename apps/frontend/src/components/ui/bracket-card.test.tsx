import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { BracketCard } from './bracket-card';

describe('BracketCard', () => {
  it('renders children', () => {
    render(<BracketCard>Hello</BracketCard>);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('applies className to wrapper', () => {
    const { container } = render(<BracketCard className="test-class">x</BracketCard>);
    expect(container.firstChild).toHaveClass('test-class');
  });
});

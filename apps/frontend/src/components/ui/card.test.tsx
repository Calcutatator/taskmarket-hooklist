import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card';

describe('Card', () => {
  it('renders with the shared polished surface styles', () => {
    const { container } = render(<Card>Body</Card>);

    expect(container.firstChild).toHaveClass('shadow-soft');
    expect(container.firstChild).toHaveClass('bg-background-primary');
  });

  it('renders title, description, and content helpers', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Tasks</CardTitle>
          <CardDescription>Browse open work.</CardDescription>
        </CardHeader>
        <CardContent>Card body</CardContent>
      </Card>
    );

    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('Browse open work.')).toBeInTheDocument();
    expect(screen.getByText('Card body')).toBeInTheDocument();
  });
});

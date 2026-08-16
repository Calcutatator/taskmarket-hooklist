import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { GameCover } from './game-cover';

describe('GameCover', () => {
  it('keeps an accessible fallback when a curated cover cannot load', () => {
    render(
      <GameCover
        alt="Orbit cover art"
        coverUrl="https://covers.taskmarket.dev/orbit.webp"
        title="Silent Orbit"
      />
    );

    fireEvent.error(screen.getByRole('img', { name: 'Orbit cover art' }));

    expect(screen.getByRole('img', { name: 'Cover unavailable for Silent Orbit' })).toBeVisible();
    expect(screen.getByText('Cover unavailable')).toBeVisible();
  });

  it('uses the fallback when the catalog has no delivery URL', () => {
    render(<GameCover alt="Unused" coverUrl={null} title="Circuit Race" />);

    expect(screen.getByRole('img', { name: 'Cover unavailable for Circuit Race' })).toBeVisible();
  });

  it('retries a cover when a fresh delivery URL replaces a failed URL', () => {
    const { rerender } = render(
      <GameCover
        alt="Orbit cover art"
        coverUrl="https://covers.taskmarket.dev/expired-orbit.webp"
        title="Silent Orbit"
      />
    );

    fireEvent.error(screen.getByRole('img', { name: 'Orbit cover art' }));

    rerender(
      <GameCover
        alt="Orbit cover art"
        coverUrl="https://covers.taskmarket.dev/fresh-orbit.webp"
        title="Silent Orbit"
      />
    );

    expect(screen.getByRole('img', { name: 'Orbit cover art' })).toHaveAttribute(
      'src',
      'https://covers.taskmarket.dev/fresh-orbit.webp'
    );
  });
});

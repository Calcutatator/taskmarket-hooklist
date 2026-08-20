/**
 * Writing shareable state.
 *
 * Verifies: ADR-0096
 * Verifies: ADR-0097
 * Verifies: ADR-0102
 *
 * The case worth the file is the last one: two controls driven in quick succession. Each write
 * builds an href from the query string, and `useSearchParams()` reflects the *committed* URL --
 * `router.replace` is a transition that has not landed by the time the next line runs. Without a
 * buffer of what has already been written this tick, the second write is computed from the
 * pre-change snapshot and silently drops the first. A user meets that as "I switched the view and
 * then the sort, and the view jumped back".
 */

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { currentTestUrl, resetTestUrl } from '../../test/setup-url';
import { useUrlState } from './use-url-state';

function TwoControls() {
  const [view, setView] = useUrlState('historyView');
  const [sort, setSort] = useUrlState('historySort');

  return (
    <div>
      <span data-testid="view">{view || '(default)'}</span>
      <span data-testid="sort">{sort || '(default)'}</span>
      <button onClick={() => setView('list')} type="button">
        List view
      </button>
      <button onClick={() => setSort('oldest')} type="button">
        Sort oldest
      </button>
      <button
        onClick={() => {
          setView('list');
          setSort('oldest');
        }}
        type="button"
      >
        Both at once
      </button>
    </div>
  );
}

describe('useUrlState', () => {
  it('reads its value from the URL rather than from local state', () => {
    resetTestUrl('/tasks/x?historyView=list');
    render(<TwoControls />);
    expect(screen.getByTestId('view')).toHaveTextContent('list');
  });

  it('writes a value to the URL', async () => {
    resetTestUrl('/tasks/x');
    const user = userEvent.setup();
    render(<TwoControls />);

    await user.click(screen.getByRole('button', { name: 'List view' }));
    expect(currentTestUrl()).toContain('historyView=list');
    expect(screen.getByTestId('view')).toHaveTextContent('list');
  });

  it('omits a param set back to its default', async () => {
    resetTestUrl('/tasks/x?historySort=oldest');
    const user = userEvent.setup();
    render(<TwoControls />);

    await user.click(screen.getByRole('button', { name: 'List view' }));
    // The sort it did not touch survives; the view it did is written.
    expect(currentTestUrl()).toContain('historySort=oldest');
    expect(currentTestUrl()).toContain('historyView=list');
  });

  it('keeps both values when two controls are written in one tick', async () => {
    // The regression. Two writes in one tick each computed their href from the committed URL, so
    // the second dropped the first and the first control appeared to snap back.
    resetTestUrl('/tasks/x');
    const user = userEvent.setup();
    render(<TwoControls />);

    await user.click(screen.getByRole('button', { name: 'Both at once' }));

    expect(currentTestUrl()).toContain('historyView=list');
    expect(currentTestUrl()).toContain('historySort=oldest');
    expect(screen.getByTestId('view')).toHaveTextContent('list');
    expect(screen.getByTestId('sort')).toHaveTextContent('oldest');
  });

  it('keeps both values across two separate interactions', async () => {
    resetTestUrl('/tasks/x');
    const user = userEvent.setup();
    render(<TwoControls />);

    await user.click(screen.getByRole('button', { name: 'List view' }));
    await user.click(screen.getByRole('button', { name: 'Sort oldest' }));

    expect(currentTestUrl()).toContain('historyView=list');
    expect(currentTestUrl()).toContain('historySort=oldest');
  });

  it('lets an external navigation win over anything buffered', async () => {
    resetTestUrl('/tasks/x');
    const user = userEvent.setup();
    render(<TwoControls />);

    await user.click(screen.getByRole('button', { name: 'List view' }));
    expect(currentTestUrl()).toContain('historyView=list');

    // A Back press, a pasted link, or any navigation this app did not issue.
    act(() => resetTestUrl('/tasks/x?historySort=oldest'));

    expect(screen.getByTestId('view')).toHaveTextContent('(default)');
    expect(screen.getByTestId('sort')).toHaveTextContent('oldest');

    // And the next write builds on the new address, not on the discarded buffer.
    await user.click(screen.getByRole('button', { name: 'List view' }));
    expect(currentTestUrl()).toContain('historySort=oldest');
    expect(currentTestUrl()).toContain('historyView=list');
  });
});

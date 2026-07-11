import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { PendingAction, TaskDetailResponse } from '@taskmarket/shared';

import { SplitAcceptanceGuide } from './split-acceptance-guide';

const action = {
  action: 'accept_submissions',
  role: 'requester',
  command: 'taskmarket task accept-submissions task-1 --winner 0x2:10000',
} as PendingAction;

const task = { id: 'task-1' } as unknown as TaskDetailResponse;

describe('SplitAcceptanceGuide', () => {
  it('points a blocked requester at funding rather than connecting', () => {
    render(<SplitAcceptanceGuide action={action} disabled task={task} />);

    // The action is only visible to the connected requester wallet, so a
    // disabled guide means the paid action is blocked by funding.
    expect(screen.getByText(/fund the connected wallet/i)).toBeInTheDocument();
    expect(screen.queryByText(/connect the requester wallet/i)).not.toBeInTheDocument();
  });

  it('shows no blocker message when enabled', () => {
    render(<SplitAcceptanceGuide action={action} disabled={false} task={task} />);

    expect(screen.queryByText(/fund the connected wallet/i)).not.toBeInTheDocument();
  });
});

import { describe, expect, it } from 'vitest';

import {
  calculateFirstRunPoints,
  createDefaultFirstRunState,
  deriveFirstRunProgress,
  readFirstRunState,
  setFirstRunVisibility,
  writeFirstRunState,
} from './first-run-state';

describe('first-run state', () => {
  it('calculates points from completed steps', () => {
    expect(
      calculateFirstRunPoints({
        postedTask: true,
        respondedToTask: true,
      })
    ).toBe(100);
  });

  it('merges wallet, local, and URL completion signals', () => {
    const localState = createDefaultFirstRunState();

    const progress = deriveFirstRunProgress({
      localState,
      publishedTask: true,
      walletProgress: {
        postedTask: false,
        respondedToTask: true,
      },
    });

    expect(progress.completed).toEqual({
      postedTask: true,
      respondedToTask: true,
    });
    expect(progress.points).toBe(100);
    expect(progress.nextStep).toBeNull();
  });

  it('keeps minimize separate from dismissal', () => {
    const minimized = setFirstRunVisibility(createDefaultFirstRunState(), 'minimized');
    expect(minimized.visibility).toBe('minimized');
    expect(minimized.minimizedAt).toEqual(expect.any(String));
    expect(minimized.dismissedAt).toBeNull();

    const open = setFirstRunVisibility(minimized, 'open');
    expect(open.visibility).toBe('open');
    expect(open.dismissedAt).toBeNull();

    const dismissed = setFirstRunVisibility(open, 'dismissed');
    expect(dismissed.visibility).toBe('dismissed');
    expect(dismissed.dismissedAt).toEqual(expect.any(String));
  });

  it('keeps local completion and visibility scoped to one wallet', () => {
    const walletA = '0x1111111111111111111111111111111111111111';
    const walletB = '0x2222222222222222222222222222222222222222';
    const walletAState = createDefaultFirstRunState();
    walletAState.completed.postedTask = true;
    walletAState.visibility = 'minimized';

    writeFirstRunState(localStorage, walletAState, walletA);

    expect(readFirstRunState(localStorage, walletA)).toMatchObject({
      completed: { postedTask: true, respondedToTask: false },
      visibility: 'minimized',
    });
    expect(readFirstRunState(localStorage, walletB)).toMatchObject({
      completed: { postedTask: false, respondedToTask: false },
      visibility: 'open',
    });
  });
});

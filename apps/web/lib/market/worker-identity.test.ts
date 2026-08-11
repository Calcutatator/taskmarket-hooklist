import { describe, expect, it } from 'vitest';

import { workerAgentIdFor } from './worker-identity';

const WORKER_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const WORKER_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('workerAgentIdFor', () => {
  it('returns the agentId from the award that names this address', () => {
    const task = {
      awards: [
        { workerAddress: WORKER_A, workerAgentId: '11' },
        { workerAddress: WORKER_B, workerAgentId: '22' },
      ],
    };

    expect(workerAgentIdFor(task, WORKER_B)).toBe('22');
  });

  it('never lends one worker another worker agentId', () => {
    // The failure this guards: a task holds several worker identities, and pairing a resolved
    // address with whichever id sits on the task would confidently show the wrong name.
    const task = {
      awards: [{ workerAddress: WORKER_A, workerAgentId: '11' }],
      claimedBy: WORKER_A,
      workerAgentId: '11',
    };

    expect(workerAgentIdFor(task, WORKER_B)).toBeNull();
  });

  it('falls back to the claimed worker identity when no award matches', () => {
    const task = { awards: [], claimedBy: WORKER_A, workerAgentId: '11' };

    expect(workerAgentIdFor(task, WORKER_A)).toBe('11');
  });

  it('matches addresses case-insensitively', () => {
    const task = { claimedBy: WORKER_A.toUpperCase(), workerAgentId: '11' };

    expect(workerAgentIdFor(task, WORKER_A)).toBe('11');
  });

  it('returns null for an unregistered worker so the caller shows the address', () => {
    const task = { claimedBy: WORKER_A, workerAgentId: null };

    expect(workerAgentIdFor(task, WORKER_A)).toBeNull();
  });

  it('returns null when there is no worker at all', () => {
    expect(workerAgentIdFor({ claimedBy: WORKER_A, workerAgentId: '11' }, null)).toBeNull();
  });
});

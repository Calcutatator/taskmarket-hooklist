// Verifies: RFC-0006 Tier 2 CLI structured-status change
// docs/specs/submission-tier-2-hard-ceiling.md "CLI: structured status on the existing JSON
// error envelope" -- Testing & Verification cases 17-18.
//
// index.ts registers every real command at module load and immediately runs
// `program.parseAsync(process.argv).catch(...)`. To exercise only the top-level catch's
// envelope-building logic in isolation, `commander` and every command module are mocked so
// module load is a no-op beyond wiring, and `parseAsync` is fully controlled by each test.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockParseAsync = vi.fn();

vi.mock('commander', () => {
  class Command {
    name(): this {
      return this;
    }
    description(): this {
      return this;
    }
    version(): this {
      return this;
    }
    addCommand(): this {
      return this;
    }
    parseAsync = mockParseAsync;
  }
  return { Command };
});

const dummyCommand = { name: 'dummy' };
vi.mock('../../src/commands/init.js', () => ({ initCommand: dummyCommand }));
vi.mock('../../src/commands/address.js', () => ({ addressCommand: dummyCommand }));
vi.mock('../../src/commands/identity.js', () => ({ identityCommand: dummyCommand }));
vi.mock('../../src/commands/stats.js', () => ({ statsCommand: dummyCommand }));
vi.mock('../../src/commands/task/index.js', () => ({ taskCommand: dummyCommand }));
vi.mock('../../src/commands/agents.js', () => ({ agentsCommand: dummyCommand }));
vi.mock('../../src/commands/inbox.js', () => ({ inboxCommand: dummyCommand }));
vi.mock('../../src/commands/deposit.js', () => ({ depositCommand: dummyCommand }));
vi.mock('../../src/commands/wallet/index.js', () => ({ walletCommand: dummyCommand }));
vi.mock('../../src/commands/withdraw.js', () => ({ withdrawCommand: dummyCommand }));
vi.mock('../../src/commands/encrypt.js', () => ({ encryptCommand: dummyCommand }));
vi.mock('../../src/commands/decrypt.js', () => ({ decryptCommand: dummyCommand }));
vi.mock('../../src/commands/xmtp.js', () => ({ xmtpCommand: dummyCommand }));
vi.mock('../../src/commands/daemon.js', () => ({ daemonCommand: dummyCommand }));
vi.mock('../../src/commands/email/index.js', () => ({ emailCommand: dummyCommand }));
vi.mock('../../src/commands/requester/index.js', () => ({ requesterCmd: dummyCommand }));
vi.mock('../../src/commands/legal/index.js', () => ({ legalCommand: dummyCommand }));

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('CLI top-level error envelope', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    mockParseAsync.mockReset();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('writes { ok: false, error, status: 429 } and exits 1 for an ApiError with .status = 429', async () => {
    const { ApiError } = await import('../../src/lib/api.js');
    mockParseAsync.mockImplementation(() =>
      Promise.reject(new ApiError(429, 'too many submissions'))
    );

    await import('../../src/index.js');
    await flushMicrotasks();

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const written = stderrSpy.mock.calls[0]?.[0] as string;
    expect(JSON.parse(written)).toEqual({
      ok: false,
      error: 'too many submissions',
      status: 429,
    });
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('writes { ok: false, error } with no status key at all for a plain Error', async () => {
    mockParseAsync.mockImplementation(() => Promise.reject(new Error('generic failure')));

    await import('../../src/index.js');
    await flushMicrotasks();

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const written = stderrSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written) as Record<string, unknown>;
    expect(parsed).toEqual({ ok: false, error: 'generic failure' });
    expect('status' in parsed).toBe(false);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

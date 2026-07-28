import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/config/env', () => ({
  getServerConfig: vi.fn().mockReturnValue({ NODE_ENV: 'test' }),
}));

import { logger, morganStream } from '../../../src/lib/logger';

const ESC = String.fromCharCode(27);
const BELL = String.fromCharCode(7);
const NUL = String.fromCharCode(0);

describe('morganStream', () => {
  it('passes an ordinary request log line through unchanged (aside from trimming)', () => {
    const spy = vi.spyOn(logger, 'http').mockImplementation(() => logger);

    morganStream.write('GET /api/tasks 200 12ms\n');

    expect(spy).toHaveBeenCalledWith('GET /api/tasks 200 12ms');
    spy.mockRestore();
  });

  it('strips ANSI escape sequences from attacker-controlled request metadata before logging', () => {
    const spy = vi.spyOn(logger, 'http').mockImplementation(() => logger);

    // Simulates a User-Agent/Referer containing a CSI escape sequence designed to
    // manipulate the terminal of an operator tailing live logs.
    const malicious = `GET /api/tasks 200 - "${ESC}[2J${ESC}[Hfaked log line"\n`;
    morganStream.write(malicious);

    const logged = spy.mock.calls[0][0] as unknown as string;
    expect(logged).not.toContain(ESC);
    spy.mockRestore();
  });

  it('strips raw control characters from logged lines', () => {
    const spy = vi.spyOn(logger, 'http').mockImplementation(() => logger);

    morganStream.write(`GET /api/tasks 200 - "user-agent${BELL}with${NUL}bell-and-nul"\n`);

    const logged = spy.mock.calls[0][0] as unknown as string;
    // eslint-disable-next-line no-control-regex
    expect(logged).not.toMatch(/[\x00-\x08\x0e-\x1f\x7f]/);
    spy.mockRestore();
  });
});

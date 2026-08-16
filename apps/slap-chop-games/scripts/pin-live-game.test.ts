import { describe, expect, it, vi } from 'vitest';

import { runPinLiveGameCommand } from './pin-live-game';

const taskId = 'task-moon-dial';
const workerAddress = '0x52d027bf9282746946708fa499dddf659f4e390c';
const html = '<!doctype html><html><head><title>Moon Dial</title></head><body>play</body></html>';
const sha256Hash = '3005f71b8d29502a5721e4dc4ed52eec5b0ab063d90e0553979e8d157aa37da1';
const keccak256Hash = `0x${'a'.repeat(64)}`;
const signedArtifactUrl =
  'https://storage.taskmarket.test/game.html?X-Amz-Signature=do-not-print-this';

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
  });
}

function taskResponse() {
  return {
    description: 'Build a compact lunar puzzle game.',
    id: taskId,
    primaryAward: { workerAddress: workerAddress.toUpperCase() },
    status: 'completed',
    submissionVisibility: 'public',
    tags: ['puzzle', 'moon'],
    taskVisibility: 'public',
  };
}

function submissionResponse() {
  return [
    {
      artifacts: [
        {
          fileName: 'game.html',
          id: 'artifact-moon-dial',
          keccak256Hash,
          mimeType: 'text/html',
          previewExpiresAt: '2099-08-17T12:00:00.000Z',
          previewUrl: signedArtifactUrl,
          role: 'final',
          sha256Hash,
          sizeBytes: 82,
        },
      ],
      id: 'submission-moon-dial',
      rejectedAt: null,
      submittedAt: '2026-08-01T02:03:04.000Z',
      workerAddress,
      workerAgentId: '42',
    },
  ];
}

function commandFetcher(options: { submissions?: unknown; artifactBody?: string } = {}) {
  return vi.fn(async (input: string | URL) => {
    const url = new URL(input);
    if (url.hostname === 'storage.taskmarket.test') {
      return new Response(options.artifactBody ?? html, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    if (url.pathname.endsWith('/submissions')) {
      expect(url.searchParams.get('includePreviewUrls')).toBe('media');
      return jsonResponse(options.submissions ?? submissionResponse());
    }
    return jsonResponse(taskResponse());
  });
}

describe('slap-chop pin command', () => {
  it('verifies a production game and emits a deterministic review packet', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const fetcher = commandFetcher();

    const exitCode = await runPinLiveGameCommand([`https://taskmarket.dev/tasks/${taskId}`], {
      fetcher,
      now: () => new Date('2026-08-17T10:00:00.000Z'),
      sourceApiUrl: 'https://api.taskmarket.test',
      writeError: (message) => stderr.push(message),
      writeOutput: (message) => stdout.push(message),
    });

    const output = stdout.join('\n');
    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain('Slap-Chop DEVNET pin candidate');
    expect(output).toContain('"slug": "moon-dial"');
    expect(output).toContain('"title": "Moon Dial"');
    expect(output).toContain(`"artifactSha256Hash": "${sha256Hash}"`);
    expect(output).toContain(`"artifactKeccak256Hash": "${keccak256Hash}"`);
    expect(output).toContain('"artifactHost": "storage.taskmarket.test"');
    expect(output).toContain('"creatorName": "Agent 42"');
    expect(output).toContain(
      '"description": "TODO: Write a concise catalog description for Moon Dial"'
    );
    expect(output).not.toContain('Build a compact lunar puzzle game.');
    expect(output).not.toContain('do-not-print-this');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('fails closed when accepted-submission provenance is ambiguous', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const duplicate = { ...submissionResponse()[0], id: 'another-submission' };

    const exitCode = await runPinLiveGameCommand([taskId], {
      fetcher: commandFetcher({ submissions: [...submissionResponse(), duplicate] }),
      now: () => new Date('2026-08-17T10:00:00.000Z'),
      sourceApiUrl: 'https://api.taskmarket.test',
      writeError: (message) => stderr.push(message),
      writeOutput: (message) => stdout.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join('\n')).toContain('SLAP_CHOP_PIN_SUBMISSION_ID=<id>');
    expect(stderr.join('\n')).toContain('another-submission');
  });

  it('pins an explicitly selected submission from an ambiguous awarded worker', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const selected = { ...submissionResponse()[0], id: 'selected-submission' };

    const exitCode = await runPinLiveGameCommand([taskId], {
      fetcher: commandFetcher({ submissions: [...submissionResponse(), selected] }),
      now: () => new Date('2026-08-17T10:00:00.000Z'),
      sourceApiUrl: 'https://api.taskmarket.test',
      submissionId: selected.id,
      writeError: (message) => stderr.push(message),
      writeOutput: (message) => stdout.push(message),
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join('\n')).toContain('"submissionId": "selected-submission"');
  });

  it('rejects a selected submission that does not belong to the awarded worker', async () => {
    const stderr: string[] = [];

    const exitCode = await runPinLiveGameCommand([taskId], {
      fetcher: commandFetcher(),
      now: () => new Date('2026-08-17T10:00:00.000Z'),
      sourceApiUrl: 'https://api.taskmarket.test',
      submissionId: 'not-an-awarded-submission',
      writeError: (message) => stderr.push(message),
      writeOutput: vi.fn(),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain(
      'is not a non-rejected submission from the primary awarded worker'
    );
  });

  it('rejects downloaded bytes that do not match production metadata', async () => {
    const stderr: string[] = [];

    const exitCode = await runPinLiveGameCommand([taskId], {
      fetcher: commandFetcher({ artifactBody: `${html.slice(0, -1)}x` }),
      now: () => new Date('2026-08-17T10:00:00.000Z'),
      sourceApiUrl: 'https://api.taskmarket.test',
      writeError: (message) => stderr.push(message),
      writeOutput: vi.fn(),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('downloaded SHA-256 does not match');
  });
});

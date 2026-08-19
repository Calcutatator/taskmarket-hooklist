// Verifies: ADR-0092
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  externalResponseData,
  isPrivateNetworkAddress,
  loadExternalHeaders,
  parseExternalX402Url,
  prepareX402HttpRequest,
  validateExternalX402Destination,
} from '../../src/lib/x402-http.js';

describe('external x402 HTTP safety', () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'x402-http-test-'));
  });

  afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('accepts HTTPS and rejects HTTP or URL userinfo', () => {
    expect(parseExternalX402Url('https://api.example.com/paid').hostname).toBe('api.example.com');
    expect(() => parseExternalX402Url('http://api.example.com')).toThrow('HTTPS');
    expect(() => parseExternalX402Url('https://user:pass@api.example.com')).toThrow('userinfo');
  });

  it('recognizes private and reserved address families', () => {
    expect(isPrivateNetworkAddress('127.0.0.1')).toBe(true);
    expect(isPrivateNetworkAddress('10.0.0.1')).toBe(true);
    expect(isPrivateNetworkAddress('169.254.1.1')).toBe(true);
    expect(isPrivateNetworkAddress('::1')).toBe(true);
    expect(isPrivateNetworkAddress('fd00::1')).toBe(true);
    expect(isPrivateNetworkAddress('8.8.8.8')).toBe(false);
  });

  it('rejects private DNS results unless policy explicitly allows them', async () => {
    const resolve = async () => [{ address: '127.0.0.1', family: 4 as const }];
    await expect(
      validateExternalX402Destination(new URL('https://api.example.com'), {
        allowPrivateNetwork: false,
        resolve: resolve as never,
      })
    ).rejects.toThrow('private or reserved');
    await expect(
      validateExternalX402Destination(new URL('https://api.example.com'), {
        allowPrivateNetwork: true,
        resolve: resolve as never,
      })
    ).resolves.toBeUndefined();
  });

  it('requires one valid JSON body for POST and reuses its exact bytes', async () => {
    const bodyPath = path.join(temporaryDirectory, 'body.json');
    await fs.writeFile(bodyPath, '{ "prompt": "hello" }');
    const request = await prepareX402HttpRequest({
      rawUrl: 'https://api.example.com/generate',
      method: 'POST',
      bodyFile: bodyPath,
    });
    expect(Buffer.from(request.body!).toString('utf8')).toBe('{ "prompt": "hello" }');
    expect(request.headers['content-type']).toBe('application/json');
    await expect(
      prepareX402HttpRequest({
        rawUrl: 'https://api.example.com/generate',
        method: 'POST',
        json: '{}',
        bodyFile: bodyPath,
      })
    ).rejects.toThrow('only one');
  });

  it('rejects payment and hop-by-hop headers', async () => {
    await expect(
      prepareX402HttpRequest({
        rawUrl: 'https://api.example.com',
        method: 'GET',
        headers: { 'PAYMENT-SIGNATURE': 'bad' },
      })
    ).rejects.toThrow('controlled');
    await expect(
      prepareX402HttpRequest({
        rawUrl: 'https://api.example.com',
        method: 'GET',
        headers: { 'X-Taskmarket-Legal-Receipt': 'secret' },
      })
    ).rejects.toThrow('controlled');
  });

  it('loads secrets through owner-only header files and environment references', async () => {
    const headersPath = path.join(temporaryDirectory, 'headers.json');
    await fs.writeFile(headersPath, JSON.stringify({ Authorization: 'Bearer file' }), {
      mode: 0o600,
    });
    process.env['X402_TEST_KEY'] = 'env-value';
    const headers = await loadExternalHeaders({
      headersFile: headersPath,
      headerEnv: ['x-api-key=X402_TEST_KEY'],
    });
    expect(headers).toEqual({ authorization: 'Bearer file', 'x-api-key': 'env-value' });
    delete process.env['X402_TEST_KEY'];
  });

  it('rejects header files readable by group or others', async () => {
    const headersPath = path.join(temporaryDirectory, 'headers.json');
    await fs.writeFile(headersPath, '{}', { mode: 0o644 });
    await expect(loadExternalHeaders({ headersFile: headersPath })).rejects.toThrow(
      'group or others'
    );
  });

  it('returns JSON response metadata without losing the body', async () => {
    const response = new Response(JSON.stringify({ result: 'ok' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const result = await externalResponseData(response);
    expect(result.body).toEqual({ result: 'ok' });
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.sha256).toHaveLength(64);
  });

  it('writes binary output exclusively and refuses overwrite', async () => {
    const outputPath = path.join(temporaryDirectory, 'result.bin');
    const first = new Response(new Uint8Array([1, 2, 3]));
    await expect(externalResponseData(first, { outputPath })).resolves.toMatchObject({
      outputPath,
      bytes: 3,
    });
    const second = new Response(new Uint8Array([4]));
    await expect(externalResponseData(second, { outputPath })).rejects.toThrow('already exists');
  });
});

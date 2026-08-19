// Implements: ADR-0092
import { createHash, randomUUID } from 'crypto';
import { promises as dns } from 'dns';
import { promises as fs } from 'fs';
import { isIP } from 'net';
import path from 'path';

const FORBIDDEN_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'payment-required',
  'payment-response',
  'payment-signature',
  'transfer-encoding',
]);

export interface PreparedX402Request {
  url: URL;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: Uint8Array;
  requestHash: string;
}

export interface ExternalResponseData {
  status: number;
  contentType: string;
  bytes: number;
  sha256: string;
  body?: unknown;
  bodyEncoding?: 'utf8' | 'base64';
  outputPath?: string;
}

export function parseExternalX402Url(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('External x402 URL is invalid');
  }
  if (url.protocol !== 'https:') throw new Error('External x402 URL must use HTTPS');
  if (url.username || url.password) throw new Error('External x402 URL must not contain userinfo');
  if (!url.hostname) throw new Error('External x402 URL must include a hostname');
  return url;
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value))) return true;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice('::ffff:'.length);
    return isIP(mapped) === 4 ? isPrivateIpv4(mapped) : true;
  }
  return false;
}

export function isPrivateNetworkAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

export async function validateExternalX402Destination(
  url: URL,
  options: {
    allowPrivateNetwork: boolean;
    resolve?: typeof dns.lookup;
  }
): Promise<void> {
  const resolve = options.resolve ?? dns.lookup;
  const addresses = await resolve(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0)
    throw new Error(`External x402 host did not resolve: ${url.hostname}`);
  if (
    !options.allowPrivateNetwork &&
    addresses.some(({ address }) => isPrivateNetworkAddress(address))
  ) {
    throw new Error(
      `External x402 host resolves to a private or reserved address: ${url.hostname}`
    );
  }
}

function assertHeaderName(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(normalized)) {
    throw new Error(`Invalid HTTP header name: ${name}`);
  }
  if (FORBIDDEN_HEADERS.has(normalized) || normalized.startsWith('x-taskmarket-')) {
    throw new Error(`HTTP header '${name}' is controlled by the x402 client`);
  }
  return normalized;
}

function assertHeaderValue(value: string): string {
  if (/\r|\n/.test(value)) throw new Error('HTTP header values must not contain newlines');
  return value;
}

export async function loadExternalHeaders(input: {
  headersFile?: string;
  headerEnv?: string[];
}): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  if (input.headersFile) {
    const handle = await fs.open(input.headersFile, 'r');
    let raw: string;
    try {
      const stat = await handle.stat();
      if (!stat.isFile())
        throw new Error(`Headers file must be a regular file: ${input.headersFile}`);
      if ((stat.mode & 0o077) !== 0) {
        throw new Error(
          `Headers file must not be accessible by group or others: ${input.headersFile}`
        );
      }
      raw = await handle.readFile('utf8');
    } finally {
      await handle.close();
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Headers file must contain a JSON object');
    }
    for (const [name, value] of Object.entries(parsed)) {
      if (typeof value !== 'string') throw new Error(`Header '${name}' must have a string value`);
      result[assertHeaderName(name)] = assertHeaderValue(value);
    }
  }
  for (const mapping of input.headerEnv ?? []) {
    const separator = mapping.indexOf('=');
    if (separator <= 0 || separator === mapping.length - 1) {
      throw new Error(`--header-env must use HEADER=ENV_VAR: ${mapping}`);
    }
    const name = assertHeaderName(mapping.slice(0, separator));
    const environmentVariable = mapping.slice(separator + 1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(environmentVariable)) {
      throw new Error(`Invalid environment variable name: ${environmentVariable}`);
    }
    const value = process.env[environmentVariable];
    if (value === undefined)
      throw new Error(`Environment variable ${environmentVariable} is not set`);
    if (result[name] !== undefined)
      throw new Error(`HTTP header '${name}' was provided more than once`);
    result[name] = assertHeaderValue(value);
  }
  return result;
}

export async function prepareX402HttpRequest(input: {
  rawUrl: string;
  method: string;
  json?: string;
  bodyFile?: string;
  headers?: Record<string, string>;
}): Promise<PreparedX402Request> {
  const url = parseExternalX402Url(input.rawUrl);
  const method = input.method.toUpperCase();
  if (method !== 'GET' && method !== 'POST') throw new Error('x402 method must be GET or POST');
  if (input.json !== undefined && input.bodyFile) {
    throw new Error('Use only one of --json or --body-file');
  }
  if (method === 'GET' && (input.json !== undefined || input.bodyFile)) {
    throw new Error('GET x402 requests cannot include a body');
  }
  if (method === 'POST' && input.json === undefined && !input.bodyFile) {
    throw new Error('POST x402 requests require --json or --body-file');
  }
  let body: Uint8Array | undefined;
  if (method === 'POST') {
    const raw = input.bodyFile ? await fs.readFile(input.bodyFile, 'utf8') : input.json!;
    try {
      JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `POST body is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    body = Buffer.from(raw, 'utf8');
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    headers[assertHeaderName(name)] = assertHeaderValue(value);
  }
  if (method === 'POST') {
    if (headers['content-type'] && headers['content-type'].toLowerCase() !== 'application/json') {
      throw new Error('JSON POST requests must use Content-Type: application/json');
    }
    headers['content-type'] = 'application/json';
  }
  const hash = createHash('sha256');
  hash.update(method);
  hash.update('\0');
  hash.update(url.toString());
  hash.update('\0');
  for (const [name, value] of Object.entries(headers).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    hash.update(name);
    hash.update('\0');
    hash.update(value);
    hash.update('\0');
  }
  if (body) hash.update(body);
  return { url, method, headers, body, requestHash: hash.digest('hex') };
}

async function writeExclusiveAtomic(outputPath: string, bytes: Uint8Array): Promise<void> {
  const directory = path.dirname(outputPath);
  await fs.mkdir(directory, { recursive: true });
  const temporaryPath = path.join(directory, `.${path.basename(outputPath)}-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporaryPath, bytes, { flag: 'wx', mode: 0o600 });
    await fs.link(temporaryPath, outputPath);
    await fs.unlink(temporaryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Output file already exists: ${outputPath}`);
    }
    throw error;
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export async function externalResponseData(
  response: Response,
  options: { outputPath?: string; inlineLimitBytes?: number } = {}
): Promise<ExternalResponseData> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (options.outputPath) {
    await writeExclusiveAtomic(options.outputPath, bytes);
    return {
      status: response.status,
      contentType,
      bytes: bytes.length,
      sha256,
      outputPath: path.resolve(options.outputPath),
    };
  }
  const inlineLimit = options.inlineLimitBytes ?? 1_048_576;
  if (bytes.length > inlineLimit) {
    throw new Error(
      `Response is ${bytes.length} bytes; use --output for responses over ${inlineLimit}`
    );
  }
  const mediaType = contentType.split(';', 1)[0].trim().toLowerCase();
  const text = Buffer.from(bytes).toString('utf8');
  if (mediaType === 'application/json' || mediaType.endsWith('+json')) {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error('Response declared JSON but contained invalid JSON');
    }
    return { status: response.status, contentType, bytes: bytes.length, sha256, body };
  }
  if (mediaType.startsWith('text/')) {
    return {
      status: response.status,
      contentType,
      bytes: bytes.length,
      sha256,
      body: text,
      bodyEncoding: 'utf8',
    };
  }
  return {
    status: response.status,
    contentType,
    bytes: bytes.length,
    sha256,
    body: Buffer.from(bytes).toString('base64'),
    bodyEncoding: 'base64',
  };
}

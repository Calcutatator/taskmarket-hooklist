import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import {
  getInteractiveHtmlEligibility,
  MAX_INTERACTIVE_HTML_BYTES,
} from '@taskmarket/html-sandbox';
import { normalizeGameCurationTaskReference } from '@taskmarket/shared';
import { z } from 'zod';

const DEFAULT_SOURCE_API_URL = 'https://api.taskmarket.dev';
const SOURCE_TIMEOUT_MS = 10_000;

const taskSchema = z.object({
  description: z.string(),
  id: z.string(),
  primaryAward: z
    .object({
      workerAddress: z.string(),
    })
    .nullable(),
  status: z.string(),
  submissionVisibility: z.string(),
  tags: z.array(z.string()),
  taskVisibility: z.string(),
});

const artifactSchema = z.object({
  fileName: z.string(),
  id: z.string(),
  keccak256Hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  mimeType: z.string(),
  previewExpiresAt: z.string().datetime().nullable().optional(),
  previewUrl: z.string().url().nullable().optional(),
  role: z.enum(['preview', 'source', 'final', 'attachment']),
  sha256Hash: z.string().regex(/^[0-9a-f]{64}$/),
  sizeBytes: z.number().int().nonnegative(),
});

const submissionSchema = z.object({
  artifacts: z.array(artifactSchema),
  id: z.string(),
  rejectedAt: z.string().datetime().nullable().optional(),
  submittedAt: z.string().datetime(),
  workerAddress: z.string(),
  workerAgentId: z.string().nullable().optional(),
});

const submissionsSchema = z.array(submissionSchema);

type PinCommandFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type PinLiveGameCommandDependencies = {
  artifactId?: string;
  fetcher?: PinCommandFetch;
  now?: () => Date;
  sourceApiUrl?: string;
  writeError?: (message: string) => void;
  writeOutput?: (message: string) => void;
};

class PinCommandError extends Error {}

function sourceUrl(baseUrl: string, path: string): URL {
  return new URL(path, `${baseUrl.replace(/\/+$/, '')}/`);
}

async function fetchJson<T>(url: URL, fetcher: PinCommandFetch, schema: z.ZodType<T>): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(url, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    });
  } catch {
    throw new PinCommandError(`could not reach ${url.origin}`);
  }

  if (!response.ok) {
    throw new PinCommandError(`${url.pathname} returned HTTP ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new PinCommandError(`${url.pathname} returned unreadable JSON`);
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new PinCommandError(`${url.pathname} returned an unexpected response shape`);
  }
  return parsed.data;
}

function normalizedAddress(address: string): string {
  return address.trim().toLowerCase();
}

function chooseArtifact(
  submission: z.infer<typeof submissionSchema>,
  requestedArtifactId: string | undefined
): z.infer<typeof artifactSchema> {
  const eligible = submission.artifacts.filter((artifact) => {
    if (artifact.role !== 'final' && artifact.role !== 'preview') return false;
    return getInteractiveHtmlEligibility(artifact).kind === 'eligible';
  });

  if (requestedArtifactId) {
    const selected = eligible.find((artifact) => artifact.id === requestedArtifactId);
    if (!selected) {
      throw new PinCommandError(
        `artifact ${requestedArtifactId} is not an eligible final or preview HTML artifact`
      );
    }
    return selected;
  }

  if (eligible.length === 0) {
    throw new PinCommandError(
      `the accepted submission has no eligible final or preview HTML artifact under ${MAX_INTERACTIVE_HTML_BYTES} bytes`
    );
  }
  if (eligible.length > 1) {
    throw new PinCommandError(
      `the accepted submission has multiple eligible HTML artifacts (${eligible
        .map((artifact) => artifact.id)
        .join(', ')}); rerun with SLAP_CHOP_PIN_ARTIFACT_ID=<id>`
    );
  }
  return eligible[0]!;
}

async function readBoundedArtifact(response: Response): Promise<Uint8Array> {
  if (!response.ok) {
    throw new PinCommandError(`artifact download returned HTTP ${response.status}`);
  }

  const declaredLength = response.headers.get('content-length');
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > MAX_INTERACTIVE_HTML_BYTES) {
      throw new PinCommandError('artifact download exceeds the interactive HTML size limit');
    }
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_INTERACTIVE_HTML_BYTES) {
      throw new PinCommandError('artifact download exceeds the interactive HTML size limit');
    }
    return bytes;
  }

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  let readerDone = false;
  while (!readerDone) {
    const { done, value } = await reader.read();
    if (done) {
      readerDone = true;
      continue;
    }
    byteLength += value.byteLength;
    if (byteLength > MAX_INTERACTIVE_HTML_BYTES) {
      await reader.cancel();
      throw new PinCommandError('artifact download exceeds the interactive HTML size limit');
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function decodeHtmlTitle(rawTitle: string): string {
  return rawTitle
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function titleFromHtml(bytes: Uint8Array, taskId: string): string {
  const html = new TextDecoder().decode(bytes);
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = match ? decodeHtmlTitle(match[1]!) : '';
  return title.slice(0, 120) || `Game ${taskId.slice(0, 8)}`;
}

function slugFromTitle(title: string, taskId: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .replace(/-+$/g, '');
  return (
    slug ||
    `game-${taskId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .slice(0, 16)}`
  );
}

function formatCandidate(input: {
  artifact: z.infer<typeof artifactSchema>;
  artifactHost: string;
  submission: z.infer<typeof submissionSchema>;
  task: z.infer<typeof taskSchema>;
  title: string;
}): string {
  const slug = slugFromTitle(input.title, input.task.id);
  const candidate = {
    coverAltText: `TODO: Describe the square cover art for ${input.title}`,
    coverPath: `/live-catalog/${slug}.svg`,
    creatorName: input.submission.workerAgentId
      ? `Agent ${input.submission.workerAgentId}`
      : input.submission.workerAddress,
    description: `TODO: Write a concise catalog description for ${input.title}`,
    publishedAt: input.submission.submittedAt,
    slug,
    source: {
      artifactHost: input.artifactHost,
      artifactId: input.artifact.id,
      artifactKeccak256Hash: input.artifact.keccak256Hash,
      artifactMimeType: input.artifact.mimeType,
      artifactRole: input.artifact.role,
      artifactSha256Hash: input.artifact.sha256Hash,
      artifactSizeBytes: input.artifact.sizeBytes,
      fileName: input.artifact.fileName,
      submissionId: input.submission.id,
      taskId: input.task.id,
      workerAddress: input.submission.workerAddress,
    },
    tags: input.task.tags,
    title: input.title,
  };

  return [
    'Slap-Chop DEVNET pin candidate',
    `Task: https://taskmarket.dev/tasks/${encodeURIComponent(input.task.id)}`,
    `Submission: ${input.submission.id}`,
    `Artifact: ${input.artifact.id}`,
    `Verified bytes: ${input.artifact.sizeBytes} (SHA-256 matched production metadata)`,
    `Pinned storage host: ${input.artifactHost}`,
    '',
    'Review before adding to LIVE_GAME_PINS:',
    '- Play the game through the Slap-Chop sandbox.',
    '- Replace the TODO description with concise catalog copy.',
    `- Add ${candidate.coverPath} and replace the TODO cover alt text.`,
    '- Confirm the title, slug, creator, tags, and cover are suitable for the public catalog.',
    '',
    'Manifest entry:',
    `${JSON.stringify(candidate, null, 2)},`,
  ].join('\n');
}

async function buildCandidate(
  taskReference: string,
  dependencies: Required<
    Pick<
      PinLiveGameCommandDependencies,
      'fetcher' | 'now' | 'sourceApiUrl' | 'writeError' | 'writeOutput'
    >
  > &
    Pick<PinLiveGameCommandDependencies, 'artifactId'>
): Promise<string> {
  let taskId: string;
  try {
    taskId = normalizeGameCurationTaskReference(taskReference);
  } catch (error) {
    throw new PinCommandError(error instanceof Error ? error.message : 'invalid task reference');
  }

  const taskUrl = sourceUrl(dependencies.sourceApiUrl, `/api/tasks/${encodeURIComponent(taskId)}`);
  const submissionsUrl = sourceUrl(
    dependencies.sourceApiUrl,
    `/api/tasks/${encodeURIComponent(taskId)}/submissions`
  );
  submissionsUrl.searchParams.set('includePreviewUrls', 'media');

  const [task, submissions] = await Promise.all([
    fetchJson(taskUrl, dependencies.fetcher, taskSchema),
    fetchJson(submissionsUrl, dependencies.fetcher, submissionsSchema),
  ]);

  const awardedWorker = task.primaryAward?.workerAddress;
  if (
    task.id !== taskId ||
    task.status !== 'completed' ||
    task.taskVisibility !== 'public' ||
    task.submissionVisibility !== 'public' ||
    !awardedWorker
  ) {
    throw new PinCommandError('task is not a completed, public Taskmarket source with an award');
  }

  const acceptedSubmissions = submissions.filter(
    (submission) =>
      submission.rejectedAt == null &&
      normalizedAddress(submission.workerAddress) === normalizedAddress(awardedWorker)
  );
  if (acceptedSubmissions.length !== 1) {
    throw new PinCommandError('task does not have one unambiguous accepted submission');
  }

  const submission = acceptedSubmissions[0]!;
  const artifact = chooseArtifact(submission, dependencies.artifactId);
  if (!artifact.previewUrl || !artifact.previewExpiresAt) {
    throw new PinCommandError('the selected artifact has no current production delivery URL');
  }
  if (new Date(artifact.previewExpiresAt).getTime() <= dependencies.now().getTime()) {
    throw new PinCommandError('the selected artifact production delivery URL is expired');
  }

  const deliveryUrl = new URL(artifact.previewUrl);
  if (deliveryUrl.protocol !== 'https:') {
    throw new PinCommandError('the selected artifact delivery URL is not HTTPS');
  }

  let artifactResponse: Response;
  try {
    artifactResponse = await dependencies.fetcher(deliveryUrl, {
      cache: 'no-store',
      headers: { accept: 'text/html,application/xhtml+xml' },
      redirect: 'error',
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    });
  } catch {
    throw new PinCommandError('could not download the selected production artifact');
  }
  const bytes = await readBoundedArtifact(artifactResponse);
  if (bytes.byteLength !== artifact.sizeBytes) {
    throw new PinCommandError(
      `downloaded byte size does not match production metadata (${bytes.byteLength} != ${artifact.sizeBytes})`
    );
  }

  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  if (actualSha256 !== artifact.sha256Hash) {
    throw new PinCommandError('downloaded SHA-256 does not match production metadata');
  }

  return formatCandidate({
    artifact,
    artifactHost: deliveryUrl.hostname,
    submission,
    task,
    title: titleFromHtml(bytes, task.id),
  });
}

export async function runPinLiveGameCommand(
  args: string[],
  options: PinLiveGameCommandDependencies = {}
): Promise<number> {
  const writeOutput =
    options.writeOutput ?? ((message: string) => process.stdout.write(`${message}\n`));
  const writeError =
    options.writeError ?? ((message: string) => process.stderr.write(`${message}\n`));
  if (args.length !== 1 || !args[0]?.trim()) {
    writeError('Usage: make slap-chop pin <task-url-or-id>');
    return 1;
  }

  try {
    const candidate = await buildCandidate(args[0], {
      artifactId: options.artifactId,
      fetcher: options.fetcher ?? globalThis.fetch,
      now: options.now ?? (() => new Date()),
      sourceApiUrl: options.sourceApiUrl ?? DEFAULT_SOURCE_API_URL,
      writeError,
      writeOutput,
    });
    writeOutput(candidate);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    writeError(`Unable to generate Slap-Chop pin: ${message}`);
    return 1;
  }
}

const entryPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entryPath === import.meta.url) {
  process.exitCode = await runPinLiveGameCommand(process.argv.slice(2), {
    artifactId: process.env.SLAP_CHOP_PIN_ARTIFACT_ID,
  });
}

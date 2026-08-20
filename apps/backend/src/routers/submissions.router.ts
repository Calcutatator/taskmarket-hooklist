import { router, publicProcedure, optionalAuthProcedure } from '../trpc';
import {
  SubmissionCreateSchema,
  SubmissionCreateFromKeysSchema,
  RequestUploadUrlInputSchema,
  RequestUploadUrlOutputSchema,
  SubmissionResponseSchema,
  AgentWorkResponseSchema,
  buildSubmitMessage,
  type ArtifactMediaKindValue,
  type ArtifactRoleValue,
} from '@taskmarket/shared';
import { z } from 'zod';
import {
  submissions,
  tasks,
  agents,
  devices,
  artifacts,
  taskAwards,
  taskAllowedViewers,
  pendingUploadKeys,
  type Agent,
  type Artifact,
  type NewArtifact,
} from '../db/schema';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { getStorageBackend } from '../lib/storage';
import { randomUUID } from 'crypto';
import { keccak256 } from 'viem';
import { TRPCError } from '@trpc/server';
import { contractSubmitWork } from '../services/contract';
import { settledPaymentReference } from '../middleware/x402';
import { runRelayedIntent } from '../services/relayed-intent-request';
import type { IntentPaymentReference } from '../services/relayed-intents';
import { derivedIdempotencyKey } from '../services/relayed-intents';
import { apiError } from '../lib/api-error';
import type { SubmissionsSubmitIntentPayload } from '../services/intents/submissions-intents';
import { buildArtifactManifestHash } from '../lib/canonical-hashes';
import { sha256Hex } from '../lib/hash';
import { verifySignedAddressOrThrow } from '../lib/agents';
import { canViewSubmission, type SubmissionVisibilityMode } from '../lib/submission-visibility';
import {
  fetchPrivateViewabilityContext,
  fetchPrivateViewabilityContextForTasks,
  type CanViewTask,
} from '../lib/task-visibility';
import type { Context } from '../context';
import { RELAYED_WRITE_REQUEST_HEADERS } from '../lib/openapi-headers';

type ArtifactInsertRow = Omit<
  NewArtifact,
  'role' | 'mediaKind' | 'displayOrder' | 'keccak256Hash'
> & {
  role: ArtifactRoleValue;
  mediaKind: ArtifactMediaKindValue;
  displayOrder: number;
  keccak256Hash: `0x${string}`;
};

function mediaKindFor(mimeType: string, fileName: string): ArtifactMediaKindValue {
  const normalized = mimeType.toLowerCase();
  const lowerName = fileName.toLowerCase();

  if (normalized.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg|avif|bmp)$/i.test(lowerName))
    return 'image';
  if (normalized.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test(lowerName)) return 'video';
  if (normalized.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|flac)$/i.test(lowerName))
    return 'audio';
  if (normalized === 'application/pdf' || lowerName.endsWith('.pdf')) return 'pdf';
  if (
    normalized.startsWith('text/') ||
    normalized.includes('json') ||
    normalized.includes('xml') ||
    normalized.includes('javascript') ||
    normalized.includes('typescript') ||
    lowerName.endsWith('.md') ||
    lowerName.endsWith('.json') ||
    lowerName.endsWith('.txt')
  ) {
    return 'text';
  }
  if (
    normalized === 'application/zip' ||
    normalized === 'application/x-zip-compressed' ||
    normalized.includes('tar') ||
    normalized.includes('gzip') ||
    lowerName.endsWith('.zip') ||
    lowerName.endsWith('.tar') ||
    lowerName.endsWith('.gz')
  ) {
    return 'archive';
  }
  return 'unknown';
}

function detectedMimeType(fileBytes: Buffer): string | null {
  if (
    fileBytes.length >= 8 &&
    fileBytes[0] === 0x89 &&
    fileBytes[1] === 0x50 &&
    fileBytes[2] === 0x4e &&
    fileBytes[3] === 0x47 &&
    fileBytes[4] === 0x0d &&
    fileBytes[5] === 0x0a &&
    fileBytes[6] === 0x1a &&
    fileBytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (fileBytes.length >= 3 && fileBytes[0] === 0xff && fileBytes[1] === 0xd8) {
    return 'image/jpeg';
  }
  if (fileBytes.subarray(0, 4).toString('ascii') === 'GIF8') {
    return 'image/gif';
  }
  if (fileBytes.subarray(0, 4).toString('ascii') === '%PDF') {
    return 'application/pdf';
  }
  if (fileBytes.length >= 4 && fileBytes[0] === 0x50 && fileBytes[1] === 0x4b) {
    return 'application/zip';
  }

  const leadingText = fileBytes.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  if (leadingText.startsWith('<svg')) return 'image/svg+xml';
  if (leadingText.length > 0 && !leadingText.includes('\u0000')) return 'text/plain';

  return null;
}

function extensionForMimeType(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case 'image/png':
      return '.png';
    case 'image/jpeg':
      return '.jpg';
    case 'image/gif':
      return '.gif';
    case 'image/svg+xml':
      return '.svg';
    case 'application/pdf':
      return '.pdf';
    case 'application/zip':
      return '.zip';
    case 'text/plain':
      return '.txt';
    default:
      return '';
  }
}

function safeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 255) || 'artifact';
}

type ArtifactPreview = {
  previewExpiresAt: string;
  previewUrl: string;
};

/**
 * Mirrors the frontend's isInteractiveHtmlArtifact (apps/web/lib/sandboxed-html.ts):
 * normalize the mimeType down to the part before any ';' parameter, trim, lowercase,
 * and compare to 'text/html'; or fall back to a .html/.htm filename suffix. Kept as a
 * local helper (not a packages/shared export) because widening it further would mean
 * also updating the frontend copy in the same change, which is out of scope here --
 * the two must be kept in sync by hand until/unless they're consolidated.
 */
function isInteractiveHtmlArtifact(row: Pick<Artifact, 'fileName' | 'mimeType'>): boolean {
  const normalizedMimeType = row.mimeType.split(';', 1)[0]?.trim().toLowerCase();
  return normalizedMimeType === 'text/html' || /\.html?$/i.test(row.fileName.trim());
}

/**
 * Artifact kinds the listing endpoints will mint a presigned previewUrl for when
 * includePreviewUrls: 'media' is requested. Interactive HTML (games, playable pages)
 * is included alongside images/video so feed covers and live poster previews get a
 * real preview instead of silently falling back to a placeholder.
 */
function canEmbedArtifactPreview(row: Artifact) {
  return row.mediaKind === 'image' || row.mediaKind === 'video' || isInteractiveHtmlArtifact(row);
}

/** task_awards-linked worker addresses (lowercased) -- the "winner(s)" winner_only reveals. */
async function winningAddressesForTask(db: Context['db'], taskId: string): Promise<Set<string>> {
  const rows = await db
    .select({ workerAddress: taskAwards.workerAddress })
    .from(taskAwards)
    .where(eq(taskAwards.taskId, taskId));
  return new Set(rows.map((row) => row.workerAddress.toLowerCase()));
}

/** Only winner_only mode needs the winner set -- every other mode short-circuits before it's used. */
async function resolveWinningAddresses(
  db: Context['db'],
  mode: SubmissionVisibilityMode,
  taskId: string
): Promise<Set<string>> {
  return mode === 'winner_only' ? winningAddressesForTask(db, taskId) : new Set<string>();
}

type VisibilityTask = CanViewTask & {
  status: string;
  verdictType: string | null;
  submissionVisibility: string;
};

/**
 * Shared "look up this one submission's visibility and throw FORBIDDEN if the
 * caller isn't entitled to see it" gate -- used by every single-submission
 * reader (previewArtifact, download), so the forbidden message is the only
 * thing that varies between them.
 *
 * Phase 3 (ADR-0030): always runs, even when submissionVisibility is 'public' -- a
 * private task must still deny a caller who can't view the task at all, regardless of
 * its submission-visibility mode (see canViewSubmission's doc comment). The fast path
 * for the common case (non-private task, public mode) still short-circuits before any
 * extra queries.
 */
async function assertSubmissionVisible(
  db: Context['db'],
  taskId: string,
  task: VisibilityTask,
  submission: { workerAddress: string } | undefined,
  caller: Context['caller'],
  taskAccessGrant: Context['taskAccessGrant'],
  forbiddenMessage: string
): Promise<void> {
  const mode = task.submissionVisibility as SubmissionVisibilityMode;
  if (task.taskVisibility !== 'private' && mode === 'public') return;

  const winningAddresses = await resolveWinningAddresses(db, mode, taskId);
  const taskViewability =
    task.taskVisibility === 'private'
      ? { taskAccessGrant, ...(await fetchPrivateViewabilityContext(db, taskId)) }
      : { taskAccessGrant };

  const visible =
    !!submission &&
    canViewSubmission({
      mode,
      taskStatus: task.status,
      taskVerdictType: task.verdictType,
      caller,
      task,
      submission,
      winningAddresses,
      taskViewability,
    });
  if (!visible) {
    throw new TRPCError({ code: 'FORBIDDEN', message: forbiddenMessage });
  }
}

/**
 * Confirms `workerAddress` has standing to submit work on a private task: the
 * requester, the pre-assigned `claimedBy`, a `task_awards`-linked worker, or an
 * explicitly allowlisted viewer (`task_allowed_viewers`). Deliberately does NOT
 * accept a `taskAccessGrant` -- that's the password-only *view* grant used by
 * `canView`'s viewability context, which proves someone can see a private task's
 * read surface, not that they're one of its participants; treating it as standing
 * here would let anyone holding the task's share link/password submit deliverables
 * on an invite-only task.
 *
 * Public/unlisted tasks return immediately -- this only ever restricts
 * `taskVisibility === 'private'` tasks, the same scope as `canView`'s truth table.
 *
 * Callers MUST invoke this only after `verifySignedAddressOrThrow` has confirmed
 * the caller actually controls `workerAddress`. Calling it beforehand would let an
 * unauthenticated caller submit arbitrary candidate addresses and use the
 * FORBIDDEN-vs-signature-error response difference as an oracle for which wallets
 * have standing on a private task.
 */
async function assertCanSubmitToTask(
  db: Context['db'],
  task: { id: string; taskVisibility: string; requester: string; claimedBy: string | null },
  workerAddress: string
): Promise<void> {
  if (task.taskVisibility !== 'private') return;

  const address = workerAddress.toLowerCase();
  if (address === task.requester.toLowerCase()) return;
  if (task.claimedBy && address === task.claimedBy.toLowerCase()) return;

  const [awardRows, viewerRows] = await Promise.all([
    db
      .select({ workerAddress: taskAwards.workerAddress })
      .from(taskAwards)
      .where(
        and(
          eq(taskAwards.taskId, task.id),
          sql`lower(${taskAwards.workerAddress}) = lower(${workerAddress})`
        )
      )
      .limit(1),
    db
      .select({ viewerAddress: taskAllowedViewers.viewerAddress })
      .from(taskAllowedViewers)
      .where(
        and(
          eq(taskAllowedViewers.taskId, task.id),
          sql`lower(${taskAllowedViewers.viewerAddress}) = lower(${workerAddress})`
        )
      )
      .limit(1),
  ]);

  if (awardRows.length > 0 || viewerRows.length > 0) return;

  throw new TRPCError({
    code: 'FORBIDDEN',
    message: 'Not authorized to submit to this private task',
  });
}

/**
 * Requires a paid submission's fee to have been paid by the worker who authored it.
 *
 * **This is not authentication, and must not be read as such.** Both submission endpoints
 * authenticate with `verifySignedAddressOrThrow` over `buildSubmitMessage`, bound to the exact
 * bytes or keys being submitted (issue #323); the x402 charge is RFC-0006 anti-spam pricing past
 * the free allowance. A fee, not a credential. That is the opposite of `pitches.select` and
 * `proofs.submit`, whose `signature` field is vestigial and whose settled payer *is* their
 * identity -- remove their equality check and anyone can act as anyone. Removing this one would
 * not do that, so the reason to have it has to stand on its own.
 *
 * It does. A submission funded by a third party is not a product feature and never was: the CLI
 * signs the submission and the payment with one key, and the web app uses the connected wallet
 * for both. The divergence is reachable only by hand-crafting a raw API call in order to create
 * it. Left open, the address recorded as having initiated the intent -- ADR-0059's initiator,
 * which is the settled payer on a paid route (ADR-0057) -- can be someone other than the author
 * of the work, so the read granted by `intents.get` lands on a party who did not do the writing.
 * That is an unintended state with nothing on the other side of the ledger, and it is closed for
 * that reason alone.
 *
 * The free path is untouched, and is checked first: past nothing but the allowance gate most
 * submissions carry no payment at all, and `settledPaymentReference` returns `undefined` for
 * every one of them.
 *
 * Ordering: `pitches.router.ts` warns that its payer check must run after identity is resolved,
 * or the FORBIDDEN-versus-payment-error difference becomes a private-task membership oracle.
 * That concern does not reach here, because there the payer check *is* the identity resolution.
 * Here identity is already resolved by the signature, and this compares the payer against an
 * address the caller has proven they control -- it reveals only whether two addresses the caller
 * chose are equal, and branches on no task state at all. It therefore runs immediately after the
 * signature check and before any private-task lookup, which is also the placement that spends no
 * queries on a request that cannot proceed.
 *
 * The fee is already settled by the time this runs -- the x402 middleware settles before tRPC --
 * so a rejection here forfeits it, exactly as the equivalent rejection in `pitches.submit` and
 * `proofs.submit` does. Nothing refunds it, because only intent settlement decides that
 * (ADR-0048) and no intent is recorded for a request refused here.
 */
function assertPaidByWorker(payment: IntentPaymentReference | undefined, workerAddress: string) {
  if (!payment) return;
  if (payment.payer.toLowerCase() === workerAddress.toLowerCase()) return;
  throw apiError({
    reason: 'payment_payer_mismatch',
    message: 'The submission fee must be paid by the worker submitting the work',
  });
}

function toArtifactResponse(
  row: Artifact,
  workerAddress: string,
  workerAgentId: string | null,
  preview?: ArtifactPreview
) {
  return {
    id: row.id,
    taskId: row.taskId,
    submissionId: row.submissionId,
    workerAddress,
    workerAgentId,
    role: row.role as ArtifactRoleValue,
    fileName: row.fileName,
    mimeType: row.mimeType,
    mediaKind: row.mediaKind as ArtifactMediaKindValue,
    storageUri: row.storageUri,
    sizeBytes: row.sizeBytes,
    sha256Hash: row.sha256Hash,
    keccak256Hash: row.keccak256Hash,
    displayOrder: row.displayOrder,
    ...(preview
      ? { previewExpiresAt: preview.previewExpiresAt, previewUrl: preview.previewUrl }
      : {}),
  };
}

export const submissionsRouter = router({
  submit: publicProcedure
    .meta({
      openapi: {
        requestHeaders: RELAYED_WRITE_REQUEST_HEADERS,
        method: 'POST',
        path: '/tasks/{taskId}/submissions',
        tags: ['Tasks'],
        summary: 'Submit work for a task',
      },
    })
    .input(SubmissionCreateSchema)
    .output(z.object({ success: z.boolean(), submissionId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const taskResult = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);

      if (taskResult.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }

      const task = taskResult[0];

      if (task.mode === 'claim') {
        if (task.status !== 'claimed') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Task not claimed' });
        }
      } else if (task.mode === 'pitch') {
        if (task.status !== 'worker_selected') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Worker not selected' });
        }
      } else if (task.mode === 'auction') {
        if (task.status !== 'claimed') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Auction winner not yet selected' });
        }
      } else if (task.mode === 'bounty' || task.mode === 'benchmark') {
        const now = new Date();
        if (task.status === 'pending_approval') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'This task already has submissions awaiting requester review — new submissions are not accepted',
          });
        }
        if (task.status !== 'open') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Task is not open for submissions' });
        }
        if (task.expiryTime && task.expiryTime < now) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Task has expired' });
        }
      }

      // Bind the signature to the exact bytes being submitted (issue #323): a signature
      // harvested from one submission must not be replayable with different file bytes.
      // This endpoint only has raw base64 bytes to work with (no artifactKey yet), so it
      // binds to the sha256 of each artifact's decoded content rather than a storage key.
      const contentBindings = input.artifacts.map((artifact) =>
        sha256Hex(Buffer.from(artifact.file, 'base64'))
      );
      const message = buildSubmitMessage(input.taskId, contentBindings);
      await verifySignedAddressOrThrow(message, input.signature, input.workerAddress, {
        invalid_signature: () =>
          new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid signature' }),
        address_mismatch: () =>
          new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Signature does not match worker address',
          }),
      });

      // Undefined on the free path (RFC-0006's allowance), which is most submissions.
      const payment = settledPaymentReference(ctx.res);
      assertPaidByWorker(payment, input.workerAddress);

      // Only compared once the caller has cryptographically proven ownership of
      // workerAddress above -- comparing task.claimedBy against an unauthenticated
      // input.workerAddress would let an attacker submit an arbitrary candidate
      // address and use the UNAUTHORIZED-vs-signature-error response difference as
      // an oracle for whether that address is the task's assigned worker, with no
      // valid signature required.
      if (task.mode === 'claim' && task.claimedBy !== input.workerAddress) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Only worker can submit',
        });
      } else if (task.mode === 'pitch' && task.claimedBy !== input.workerAddress) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Only selected worker can submit',
        });
      } else if (task.mode === 'auction' && task.claimedBy !== input.workerAddress) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Only the winning bidder can submit',
        });
      }

      // Only checked once the caller has cryptographically proven ownership of
      // workerAddress above -- see assertCanSubmitToTask's doc comment for why
      // ordering this before the signature check would create an oracle.
      await assertCanSubmitToTask(ctx.db, task, input.workerAddress);

      const storage = getStorageBackend();
      // Derived from the caller's own key rather than random. The payload is compared
      // against the stored one to tell a retry from a different write (ADR-0061), and these
      // ids travel inside it -- fresh ones on every attempt would make an honest retry of a
      // free-allowance submission look like a change of arguments and get it refused. Every
      // artifact id and storage key hangs off this one, so deriving it makes the whole
      // payload a pure function of the request.
      const submissionId = derivedIdempotencyKey(
        `${ctx.idempotencyKey}:submissions.submit:submissionId`
      );

      const artifactInputs = input.artifacts.map((artifact, index) => ({
        fileName: artifact.fileName,
        mimeType: artifact.mimeType,
        role: artifact.role,
        file: artifact.file,
        displayOrder: index,
      }));

      const artifactRows: ArtifactInsertRow[] = [];
      for (const artifactInput of artifactInputs) {
        const fileBytes = Buffer.from(artifactInput.file, 'base64');
        const mimeType =
          artifactInput.mimeType ?? detectedMimeType(fileBytes) ?? 'application/octet-stream';
        const fileName = artifactInput.fileName ?? `submission${extensionForMimeType(mimeType)}`;
        const keccak256Hash = keccak256(new Uint8Array(fileBytes));
        const sha256Hash = sha256Hex(fileBytes);
        const mediaKind = mediaKindFor(mimeType, fileName);
        const fileKey = `submissions/${input.taskId}/${submissionId}/${artifactInput.displayOrder}-${safeFileName(
          fileName
        )}`;
        const storageUri = await storage.upload(fileKey, fileBytes, {
          contentType: mimeType,
        });

        artifactRows.push({
          id: derivedIdempotencyKey(`${submissionId}:artifact:${artifactInput.displayOrder}`),
          taskId: input.taskId,
          submissionId,
          role: artifactInput.role,
          fileName,
          mimeType,
          mediaKind,
          storageUri,
          sizeBytes: fileBytes.byteLength,
          sha256Hash,
          keccak256Hash,
          displayOrder: artifactInput.displayOrder,
        });
      }

      const deliverableHash = buildArtifactManifestHash(artifactRows);

      // Free, but still an intent (ADR-0045), and this is the path where it matters most: a
      // worker whose deliverable hash the chain has committed to, and whose submission row
      // never got written because the receipt arrived after the request ended, has done work
      // the product cannot see, show or pay for. The completion handler owns every write that
      // used to run inline below it -- including the Tier 2 ceiling re-check, which has to
      // stay in the same transaction as the insert it guards.
      await runRelayedIntent({
        db: ctx.db,
        idempotencyKey: ctx.idempotencyKey,
        operation: 'submissions.submit',
        payer: input.workerAddress,
        // Present only past the free allowance (RFC-0006 Tier 1): the first few submissions
        // bypass x402 entirely and have nothing to refund, and the ones after it are charged
        // the flat action fee. Before this the paid ones recorded no payment reference at
        // all, so a submission that never reached the chain could not be refunded either.
        payment,
        payload: {
          artifacts: artifactRows,
          contractAddress: task.contractAddress,
          deliverableHash,
          mode: task.mode,
          signature: input.signature,
          submissionId,
          taskId: input.taskId,
          workerAddress: input.workerAddress,
        } satisfies SubmissionsSubmitIntentPayload,
        send: () =>
          contractSubmitWork(
            input.taskId as `0x${string}`,
            input.workerAddress as `0x${string}`,
            deliverableHash,
            task.contractAddress
          ),
        // The completion can fail for one reason a worker can act on -- the Tier 2 ceiling
        // (ADR-0037) -- and the generic "it will be retried" message would tell them nothing
        // about why their submission is not showing up. The specific reason is on the intent's
        // lastError either way; this is what puts it in front of the person who hit it.
        describeCompletionFailure: (intentId) =>
          `Your work was committed on chain but recording the submission did not complete; it will be retried automatically (intent ${intentId}). If this task is at its submission limit, the submission will not be recorded.`,
      });

      return { success: true, submissionId };
    }),

  requestUploadUrl: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/tasks/{taskId}/submissions/request-upload-url',
        tags: ['Tasks'],
        summary: 'Request a presigned S3 PUT URL for direct artifact upload',
      },
    })
    .input(RequestUploadUrlInputSchema)
    .output(RequestUploadUrlOutputSchema)
    .mutation(async ({ input, ctx }) => {
      // Verify signature before issuing any URL
      const message = buildSubmitMessage(input.taskId);
      await verifySignedAddressOrThrow(message, input.signature, input.workerAddress, {
        invalid_signature: () =>
          new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid signature' }),
        address_mismatch: () =>
          new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Signature does not match worker address',
          }),
      });

      // Guard against storage abuse: only issue URLs for tasks that are
      // actively accepting submissions. Full worker eligibility is enforced
      // at submitFromKeys time.
      const taskResult = await ctx.db
        .select({ status: tasks.status, mode: tasks.mode, expiryTime: tasks.expiryTime })
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);

      if (taskResult.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }

      const task = taskResult[0];
      const submittable =
        task.mode === 'bounty' || task.mode === 'benchmark'
          ? task.status === 'open' && !(task.expiryTime && task.expiryTime < new Date())
          : task.mode === 'auction'
            ? task.status === 'claimed'
            : task.status === 'claimed' || task.status === 'worker_selected';

      if (!submittable) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Task is not accepting submissions' });
      }

      const storage = getStorageBackend();
      const artifactKey = `submissions/${input.taskId}/pending/${randomUUID()}-${safeFileName(input.fileName)}`;
      const uploadUrl = await storage.getPresignedUploadUrl(artifactKey, input.mimeType);
      // Records which worker this key was actually issued to, so submitFromKeys can
      // verify the caller presenting it is that same worker -- the task-id prefix
      // alone doesn't prove that, since any worker eligible to call this endpoint for
      // the task can produce a key satisfying the prefix.
      await ctx.db.insert(pendingUploadKeys).values({
        artifactKey,
        taskId: input.taskId,
        workerAddress: input.workerAddress,
      });
      return { uploadUrl, artifactKey };
    }),

  submitFromKeys: publicProcedure
    .meta({
      openapi: {
        requestHeaders: RELAYED_WRITE_REQUEST_HEADERS,
        method: 'POST',
        path: '/tasks/{taskId}/submissions/from-keys',
        tags: ['Tasks'],
        summary: 'Submit work using artifact keys from presigned uploads',
      },
    })
    .input(SubmissionCreateFromKeysSchema)
    .output(z.object({ success: z.boolean(), submissionId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const taskResult = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);

      if (taskResult.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }

      const task = taskResult[0];

      if (task.mode === 'claim') {
        if (task.status !== 'claimed') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Task not claimed' });
        }
      } else if (task.mode === 'pitch') {
        if (task.status !== 'worker_selected') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Worker not selected' });
        }
      } else if (task.mode === 'auction') {
        if (task.status !== 'claimed') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Auction winner not yet selected' });
        }
      } else if (task.mode === 'bounty' || task.mode === 'benchmark') {
        const now = new Date();
        if (task.status === 'pending_approval') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'This task already has submissions awaiting requester review — new submissions are not accepted',
          });
        }
        if (task.status !== 'open') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Task is not open for submissions' });
        }
        if (task.expiryTime && task.expiryTime < now) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Task has expired' });
        }
      }

      // Bind the signature to the exact artifact keys being submitted (issue #323): a
      // signature harvested from one submission must not be replayable with different keys.
      const message = buildSubmitMessage(
        input.taskId,
        input.artifacts.map((artifact) => artifact.artifactKey)
      );
      await verifySignedAddressOrThrow(message, input.signature, input.workerAddress, {
        invalid_signature: () =>
          new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid signature' }),
        address_mismatch: () =>
          new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Signature does not match worker address',
          }),
      });

      // Undefined on the free path (RFC-0006's allowance), which is most submissions.
      const payment = settledPaymentReference(ctx.res);
      assertPaidByWorker(payment, input.workerAddress);

      // Only compared once the caller has cryptographically proven ownership of
      // workerAddress above -- comparing task.claimedBy against an unauthenticated
      // input.workerAddress would let an attacker submit an arbitrary candidate
      // address and use the UNAUTHORIZED-vs-signature-error response difference as
      // an oracle for whether that address is the task's assigned worker, with no
      // valid signature required.
      if (task.mode === 'claim' && task.claimedBy !== input.workerAddress) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Only worker can submit',
        });
      } else if (task.mode === 'pitch' && task.claimedBy !== input.workerAddress) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Only selected worker can submit',
        });
      } else if (task.mode === 'auction' && task.claimedBy !== input.workerAddress) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Only the winning bidder can submit',
        });
      }

      // Only checked once the caller has cryptographically proven ownership of
      // workerAddress above -- see assertCanSubmitToTask's doc comment for why
      // ordering this before the signature check would create an oracle.
      await assertCanSubmitToTask(ctx.db, task, input.workerAddress);

      const storage = getStorageBackend();
      // Derived from the caller's own key rather than random. The payload is compared
      // against the stored one to tell a retry from a different write (ADR-0061), and these
      // ids travel inside it -- fresh ones on every attempt would make an honest retry of a
      // free-allowance submission look like a change of arguments and get it refused. Every
      // artifact id and storage key hangs off this one, so deriving it makes the whole
      // payload a pure function of the request.
      const submissionId = derivedIdempotencyKey(
        `${ctx.idempotencyKey}:submissions.submit:submissionId`
      );

      // Reject keys that were not generated by requestUploadUrl for this task, or
      // that were issued to a different worker -- the task-id prefix alone doesn't
      // prove the caller owns the key, since any worker eligible to call
      // requestUploadUrl for this task can produce a key satisfying the prefix.
      const expectedPrefix = `submissions/${input.taskId}/`;
      const artifactKeys = input.artifacts.map((a) => a.artifactKey);
      const issuedRows =
        artifactKeys.length > 0
          ? await ctx.db
              .select({
                artifactKey: pendingUploadKeys.artifactKey,
                workerAddress: pendingUploadKeys.workerAddress,
              })
              .from(pendingUploadKeys)
              .where(inArray(pendingUploadKeys.artifactKey, artifactKeys))
          : [];
      const issuedByKey = new Map(issuedRows.map((r) => [r.artifactKey, r.workerAddress]));
      for (const artifactInput of input.artifacts) {
        if (!artifactInput.artifactKey.startsWith(expectedPrefix)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Artifact key does not belong to task ${input.taskId}`,
          });
        }
        const issuedTo = issuedByKey.get(artifactInput.artifactKey);
        if (!issuedTo || issuedTo.toLowerCase() !== input.workerAddress.toLowerCase()) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `Artifact key was not issued to this worker: ${artifactInput.artifactKey}`,
          });
        }
      }

      const artifactRows: ArtifactInsertRow[] = [];
      for (const [index, artifactInput] of input.artifacts.entries()) {
        const head = await storage.headObject(artifactInput.artifactKey);
        if (!head) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Artifact key not found in storage: ${artifactInput.artifactKey}`,
          });
        }
        if (head.contentLength !== artifactInput.sizeBytes) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Artifact size mismatch for ${artifactInput.fileName}: expected ${artifactInput.sizeBytes}, got ${head.contentLength}`,
          });
        }

        artifactRows.push({
          id: derivedIdempotencyKey(`${submissionId}:artifact:${index}`),
          taskId: input.taskId,
          submissionId,
          role: artifactInput.role,
          fileName: artifactInput.fileName,
          mimeType: artifactInput.mimeType,
          mediaKind: mediaKindFor(artifactInput.mimeType, artifactInput.fileName),
          storageUri: storage.storageUriForKey(artifactInput.artifactKey),
          sizeBytes: artifactInput.sizeBytes,
          sha256Hash: artifactInput.sha256Hash,
          keccak256Hash: artifactInput.keccak256Hash as `0x${string}`,
          displayOrder: index,
        });
      }

      const deliverableHash = buildArtifactManifestHash(artifactRows);

      // Same operation as the sibling `submit` mutation: the two differ only in how they
      // obtain the artifact rows, and by this point both hold the same deliverable hash. One
      // intent kind, one completion handler (ADR-0045).
      await runRelayedIntent({
        db: ctx.db,
        idempotencyKey: ctx.idempotencyKey,
        operation: 'submissions.submit',
        payer: input.workerAddress,
        // Present only past the free allowance (RFC-0006 Tier 1): the first few submissions
        // bypass x402 entirely and have nothing to refund, and the ones after it are charged
        // the flat action fee. Before this the paid ones recorded no payment reference at
        // all, so a submission that never reached the chain could not be refunded either.
        payment,
        payload: {
          artifacts: artifactRows,
          contractAddress: task.contractAddress,
          deliverableHash,
          mode: task.mode,
          signature: input.signature,
          submissionId,
          taskId: input.taskId,
          workerAddress: input.workerAddress,
        } satisfies SubmissionsSubmitIntentPayload,
        send: () =>
          contractSubmitWork(
            input.taskId as `0x${string}`,
            input.workerAddress as `0x${string}`,
            deliverableHash,
            task.contractAddress
          ),
        // The completion can fail for one reason a worker can act on -- the Tier 2 ceiling
        // (ADR-0037) -- and the generic "it will be retried" message would tell them nothing
        // about why their submission is not showing up. The specific reason is on the intent's
        // lastError either way; this is what puts it in front of the person who hit it.
        describeCompletionFailure: (intentId) =>
          `Your work was committed on chain but recording the submission did not complete; it will be retried automatically (intent ${intentId}). If this task is at its submission limit, the submission will not be recorded.`,
      });

      return { success: true, submissionId };
    }),

  listByTask: optionalAuthProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/tasks/{taskId}/submissions',
        tags: ['Tasks'],
        summary: 'List submissions for a task',
      },
    })
    .input(
      z.object({
        taskId: z.string(),
        includePreviewUrls: z.enum(['none', 'media']).optional().default('none'),
      })
    )
    .output(z.array(SubmissionResponseSchema))
    .query(async ({ input, ctx }) => {
      const taskResult = await ctx.db
        .select({
          id: tasks.id,
          requester: tasks.requester,
          claimedBy: tasks.claimedBy,
          evaluator: tasks.evaluator,
          disputeResolver: tasks.disputeResolver,
          taskVisibility: tasks.taskVisibility,
          status: tasks.status,
          verdictType: tasks.verdictType,
          submissionVisibility: tasks.submissionVisibility,
        })
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);

      // No task lookup existed here before Phase 2 -- an unknown taskId simply
      // has no submissions either way, so this stays a lenient empty result
      // rather than a NOT_FOUND, matching this endpoint's pre-existing behavior.
      if (taskResult.length === 0) {
        return [];
      }
      const task = taskResult[0];
      const mode = task.submissionVisibility as SubmissionVisibilityMode;

      const allResults = await ctx.db
        .select()
        .from(submissions)
        .where(eq(submissions.taskId, input.taskId));

      // public (the default) matches today's exact behavior -- every submission
      // stays visible to anyone, no role/lifecycle gating at all. Phase 3 (ADR-0030):
      // a private task must still be gated even in public mode, or a private task left
      // at the default submissionVisibility would leak every submission to anyone.
      let results = allResults;
      if (task.taskVisibility === 'private' || mode !== 'public') {
        const winningAddresses = await resolveWinningAddresses(ctx.db, mode, input.taskId);
        const taskViewability =
          task.taskVisibility === 'private'
            ? {
                taskAccessGrant: ctx.taskAccessGrant,
                ...(await fetchPrivateViewabilityContext(ctx.db, input.taskId)),
              }
            : { taskAccessGrant: ctx.taskAccessGrant };
        results = allResults.filter((submission) =>
          canViewSubmission({
            mode,
            taskStatus: task.status,
            taskVerdictType: task.verdictType,
            caller: ctx.caller,
            task,
            submission,
            winningAddresses,
            taskViewability,
          })
        );
      }

      const artifactResults =
        results.length > 0
          ? await ctx.db
              .select()
              .from(artifacts)
              .where(
                inArray(
                  artifacts.submissionId,
                  results.map((sub) => sub.id)
                )
              )
          : [];

      const uniqueWorkerAddresses = Array.from(new Set(results.map((sub) => sub.workerAddress)));
      const agentResults =
        uniqueWorkerAddresses.length > 0
          ? await ctx.db
              .select()
              .from(agents)
              // Lowercased on both sides: `agents.address` is stored lowercase while
              // `submissions.workerAddress` is checksummed, so a direct `inArray` matched almost
              // nothing -- every worker then rendered as a raw address instead of their agent
              // name. The map built below already lowercases; only the query did not.
              .where(
                inArray(
                  sql`lower(${agents.address})`,
                  uniqueWorkerAddresses.map((address) => address.toLowerCase())
                )
              )
          : [];
      const agentsByAddress = new Map<string, Agent>();
      for (const agent of agentResults) {
        agentsByAddress.set(agent.address.toLowerCase(), agent);
      }

      const previewByArtifactId = new Map<string, ArtifactPreview>();
      if (input.includePreviewUrls === 'media') {
        const expiresIn = 3600;
        const previewExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
        const previewableArtifacts = artifactResults.filter(canEmbedArtifactPreview);
        await Promise.all(
          previewableArtifacts.map(async (artifact) => {
            previewByArtifactId.set(artifact.id, {
              previewExpiresAt,
              previewUrl: await getStorageBackend().getPresignedUrl(artifact.storageUri, expiresIn),
            });
          })
        );
      }

      const artifactsBySubmission = new Map<string, Artifact[]>();
      for (const artifact of artifactResults) {
        const existing = artifactsBySubmission.get(artifact.submissionId) ?? [];
        existing.push(artifact);
        artifactsBySubmission.set(artifact.submissionId, existing);
      }

      const submissionsWithStats = results.map((sub) => {
        const agent = agentsByAddress.get(sub.workerAddress.toLowerCase());

        return {
          id: sub.id,
          // The public name (ADR-0098). Null on rows created before the backfill.
          referenceCode: sub.referenceCode,
          taskId: sub.taskId,
          workerAddress: sub.workerAddress,
          fileUrl: sub.fileUrl,
          signature: sub.signature,
          submittedAt: sub.submittedAt.toISOString(),
          rejectedAt: sub.rejectedAt?.toISOString() ?? null,
          workerAgentId: agent?.agentId ?? null,
          deliverableHash: sub.deliverableHash ?? null,
          submitTxHash: sub.submitTxHash ?? null,
          artifacts: (artifactsBySubmission.get(sub.id) ?? [])
            .slice()
            .sort((a, b) => a.displayOrder - b.displayOrder)
            .map((row) =>
              toArtifactResponse(
                row,
                sub.workerAddress,
                agent?.agentId ?? null,
                previewByArtifactId.get(row.id)
              )
            ),
          workerStats: agent
            ? {
                completedTasks: agent.completedTasks,
                ratedTasks: agent.ratedTasks,
                totalStars: Number(agent.totalStars),
                averageRating:
                  agent.ratedTasks > 0 ? Number(agent.totalStars) / agent.ratedTasks : 0,
              }
            : { completedTasks: 0, ratedTasks: 0, totalStars: 0, averageRating: 0 },
        };
      });

      return submissionsWithStats;
    }),

  listByWorker: optionalAuthProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/agents/{address}/work',
        tags: ['Agents'],
        summary: 'List a worker awarded/completed work, newest first',
      },
    })
    .input(
      z.object({
        address: z.string(),
        limit: z.number().int().min(1).max(50).optional().default(12),
        includePreviewUrls: z.enum(['none', 'media']).optional().default('media'),
      })
    )
    .output(AgentWorkResponseSchema)
    .query(async ({ input, ctx }) => {
      // Awards are authoritative for completed work, including unrated and
      // secondary split-payout recipients.
      const completedRows = await ctx.db
        .select({
          taskId: taskAwards.taskId,
          // Raw aggregate expressions come back through the driver as a plain string,
          // not run through drizzle's column-level Date mapping -- coerce at the call site.
          completedAt: sql<string>`max(${taskAwards.settledAt})`,
          description: tasks.description,
          submissionVisibility: tasks.submissionVisibility,
          taskVisibility: tasks.taskVisibility,
          claimedBy: tasks.claimedBy,
          requester: tasks.requester,
          evaluator: tasks.evaluator,
          disputeResolver: tasks.disputeResolver,
          status: tasks.status,
          verdictType: tasks.verdictType,
        })
        .from(taskAwards)
        .innerJoin(tasks, eq(tasks.id, taskAwards.taskId))
        .where(sql`lower(${taskAwards.workerAddress}) = lower(${input.address})`)
        .groupBy(
          taskAwards.taskId,
          tasks.description,
          tasks.submissionVisibility,
          tasks.taskVisibility,
          tasks.claimedBy,
          tasks.requester,
          tasks.evaluator,
          tasks.disputeResolver,
          tasks.status,
          tasks.verdictType
        )
        .orderBy(desc(sql`max(${taskAwards.settledAt})`))
        .limit(input.limit);

      // Phase 3 (ADR-0030): batch-fetch allowlist/award context for just the private
      // tasks in this result set -- zero extra queries when none of them are private.
      const privateTaskIds = completedRows
        .filter((row) => row.taskVisibility === 'private')
        .map((row) => row.taskId);
      const viewabilityByTaskId = await fetchPrivateViewabilityContextForTasks(
        ctx.db,
        privateTaskIds
      );

      // Every row here is already task_awards-linked (a "winner" by
      // definition), so this goes through the same canViewSubmission gate as
      // every other reader instead of re-deriving the truth table inline --
      // winningAddresses is seeded with just this worker since award-linkage
      // is exactly what "winner" means for winner_only.
      const completed = completedRows.filter((row) =>
        canViewSubmission({
          mode: row.submissionVisibility as SubmissionVisibilityMode,
          taskStatus: row.status,
          taskVerdictType: row.verdictType,
          caller: ctx.caller,
          task: { id: row.taskId, ...row },
          submission: { workerAddress: input.address },
          winningAddresses: new Set([input.address.toLowerCase()]),
          taskViewability: {
            taskAccessGrant: ctx.taskAccessGrant,
            ...viewabilityByTaskId.get(row.taskId),
          },
        })
      );

      if (completed.length === 0) {
        return [];
      }

      const taskIds = completed.map((row) => row.taskId);

      // Fetch the worker submissions for these tasks (one worker may have a
      // single submission per task; multiple are coalesced by task below).
      const workerSubmissions = await ctx.db
        .select()
        .from(submissions)
        .where(
          and(
            inArray(submissions.taskId, taskIds),
            sql`lower(${submissions.workerAddress}) = lower(${input.address})`
          )
        );

      const submissionIds = workerSubmissions.map((sub) => sub.id);
      const artifactResults =
        submissionIds.length > 0
          ? await ctx.db
              .select()
              .from(artifacts)
              .where(inArray(artifacts.submissionId, submissionIds))
          : [];

      // Resolve the worker agentId once for artifact responses.
      const agentResult = await ctx.db
        .select()
        .from(agents)
        .where(sql`lower(${agents.address}) = lower(${input.address})`)
        .limit(1);
      const workerAgentId = agentResult[0]?.agentId ?? null;

      // Presign media previews in one batch (same behavior as listByTask).
      const previewByArtifactId = new Map<string, ArtifactPreview>();
      if (input.includePreviewUrls === 'media') {
        const expiresIn = 3600;
        const previewExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
        const previewableArtifacts = artifactResults.filter(canEmbedArtifactPreview);
        await Promise.all(
          previewableArtifacts.map(async (artifact) => {
            previewByArtifactId.set(artifact.id, {
              previewExpiresAt,
              previewUrl: await getStorageBackend().getPresignedUrl(artifact.storageUri, expiresIn),
            });
          })
        );
      }

      // Group artifacts by task (across the worker submissions for that task).
      const submissionTaskById = new Map<string, string>();
      for (const sub of workerSubmissions) {
        submissionTaskById.set(sub.id, sub.taskId);
      }
      const artifactsByTask = new Map<string, Artifact[]>();
      for (const artifact of artifactResults) {
        const taskId = submissionTaskById.get(artifact.submissionId);
        if (!taskId) {
          continue;
        }
        const existing = artifactsByTask.get(taskId) ?? [];
        existing.push(artifact);
        artifactsByTask.set(taskId, existing);
      }

      return completed.map((row) => ({
        taskId: row.taskId,
        taskTitle: row.description.split('\n')[0]!.slice(0, 80),
        completedAt: new Date(row.completedAt).toISOString(),
        artifacts: (artifactsByTask.get(row.taskId) ?? [])
          .slice()
          .sort((a, b) => a.displayOrder - b.displayOrder)
          .map((artifact) =>
            toArtifactResponse(
              artifact,
              input.address,
              workerAgentId,
              previewByArtifactId.get(artifact.id)
            )
          ),
      }));
    }),

  preview: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/tasks/{taskId}/submissions/{submissionId}/preview',
        tags: ['Tasks'],
        summary: 'Get presigned download URL for a submission (requester or worker, pre-accept)',
      },
    })
    .input(
      z.object({
        taskId: z.string(),
        submissionId: z.string(),
        artifactId: z.string().optional(),
        deviceId: z.string(),
        apiToken: z.string(),
      })
    )
    .output(z.object({ presignedUrl: z.string() }))
    .mutation(async ({ input, ctx }) => {
      // Verify device credentials
      const deviceResult = await ctx.db
        .select()
        .from(devices)
        .where(eq(devices.id, input.deviceId))
        .limit(1);

      if (!deviceResult.length) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid device credentials' });
      }
      const device = deviceResult[0];
      if (device.apiTokenHash !== sha256Hex(input.apiToken)) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid device credentials' });
      }
      if (device.revokedAt !== null) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Device has been revoked' });
      }

      const callerAddress = device.walletAddress.toLowerCase();

      // Look up submission
      const subResult = await ctx.db
        .select()
        .from(submissions)
        .where(eq(submissions.id, input.submissionId))
        .limit(1);

      if (!subResult.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Submission not found' });
      }
      const sub = subResult[0];
      if (sub.taskId !== input.taskId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Task/submission mismatch' });
      }

      // Look up task
      const taskResult = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);

      if (!taskResult.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }
      const task = taskResult[0];

      // Only the task requester or the submitting worker may preview
      if (
        callerAddress !== task.requester.toLowerCase() &&
        callerAddress !== sub.workerAddress.toLowerCase()
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not authorized to preview this submission',
        });
      }

      let storageUri = sub.fileUrl;
      if (input.artifactId) {
        const artifactResult = await ctx.db
          .select()
          .from(artifacts)
          .where(eq(artifacts.id, input.artifactId))
          .limit(1);
        if (!artifactResult.length) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Artifact not found' });
        }
        const artifact = artifactResult[0];
        if (artifact.taskId !== input.taskId || artifact.submissionId !== input.submissionId) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Task/submission/artifact mismatch' });
        }
        storageUri = artifact.storageUri;
      } else {
        const artifactResults = await ctx.db
          .select()
          .from(artifacts)
          .where(eq(artifacts.submissionId, input.submissionId));
        if (artifactResults.length === 1) {
          storageUri = artifactResults[0]!.storageUri;
        } else if (artifactResults.length > 1) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: '--artifact is required for this submission',
          });
        }
      }

      const storage = getStorageBackend();
      const presignedUrl = await storage.getPresignedUrl(storageUri, 3600);
      return { presignedUrl };
    }),

  previewArtifact: optionalAuthProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/tasks/{taskId}/artifacts/{artifactId}/preview',
        tags: ['Tasks'],
        summary:
          "Get a presigned preview URL for an artifact (subject to the task's submissionVisibility)",
      },
    })
    .input(z.object({ taskId: z.string(), artifactId: z.string() }))
    .output(z.object({ previewUrl: z.string(), expiresAt: z.string() }))
    .query(async ({ input, ctx }) => {
      const artifactResult = await ctx.db
        .select()
        .from(artifacts)
        .where(eq(artifacts.id, input.artifactId))
        .limit(1);

      if (!artifactResult.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Artifact not found' });
      }
      const artifact = artifactResult[0];
      if (artifact.taskId !== input.taskId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Task/artifact mismatch' });
      }

      const taskResult = await ctx.db
        .select({
          id: tasks.id,
          requester: tasks.requester,
          claimedBy: tasks.claimedBy,
          evaluator: tasks.evaluator,
          disputeResolver: tasks.disputeResolver,
          taskVisibility: tasks.taskVisibility,
          status: tasks.status,
          verdictType: tasks.verdictType,
          submissionVisibility: tasks.submissionVisibility,
        })
        .from(tasks)
        .where(eq(tasks.id, artifact.taskId))
        .limit(1);
      if (!taskResult.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }
      const task = taskResult[0];

      const submissionResult = await ctx.db
        .select({ workerAddress: submissions.workerAddress })
        .from(submissions)
        .where(eq(submissions.id, artifact.submissionId))
        .limit(1);
      await assertSubmissionVisible(
        ctx.db,
        artifact.taskId,
        task,
        submissionResult[0],
        ctx.caller,
        ctx.taskAccessGrant,
        'Not authorized to preview this artifact'
      );

      const expiresIn = 3600;
      const previewUrl = await getStorageBackend().getPresignedUrl(artifact.storageUri, expiresIn);
      return {
        previewUrl,
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      };
    }),

  mySubmissions: optionalAuthProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/submissions/mine',
        tags: ['Tasks'],
        summary: 'List all submissions made by a wallet address',
      },
    })
    .input(z.object({ workerAddress: z.string() }))
    .output(
      z.array(
        z.object({
          taskId: z.string(),
          taskDescription: z.string(),
          taskStatus: z.string(),
          taskMode: z.string(),
          taskReward: z.string(),
          submittedAt: z.string(),
          deliverableHash: z.string().nullable(),
          submitTxHash: z.string().nullable(),
          rejectedAt: z.string().nullable(),
        })
      )
    )
    .query(async ({ input, ctx }) => {
      const results = await ctx.db
        .select({
          taskId: submissions.taskId,
          workerAddress: submissions.workerAddress,
          submittedAt: submissions.submittedAt,
          deliverableHash: submissions.deliverableHash,
          submitTxHash: submissions.submitTxHash,
          rejectedAt: submissions.rejectedAt,
          taskDescription: tasks.description,
          taskStatus: tasks.status,
          taskVerdictType: tasks.verdictType,
          taskMode: tasks.mode,
          taskReward: tasks.reward,
          taskRequester: tasks.requester,
          taskClaimedBy: tasks.claimedBy,
          taskEvaluator: tasks.evaluator,
          taskDisputeResolver: tasks.disputeResolver,
          taskVisibility: tasks.taskVisibility,
          submissionVisibility: tasks.submissionVisibility,
        })
        .from(submissions)
        .innerJoin(tasks, eq(tasks.id, submissions.taskId))
        .where(eq(submissions.workerAddress, input.workerAddress))
        .orderBy(desc(submissions.submittedAt));

      // This endpoint is really "list this one worker's own submissions", so
      // it goes through the same canViewSubmission gate as listByTask -- the
      // worker themselves (or the task's requester) always sees their rows;
      // anyone else only sees what the task's submissionVisibility mode
      // allows once the task has ended, same truth table as everywhere else.
      const winnerOnlyTaskIds = Array.from(
        new Set(
          results
            .filter((row) => row.submissionVisibility === 'winner_only')
            .map((row) => row.taskId)
        )
      );
      const winningAddressesByTask = new Map<string, Set<string>>();
      await Promise.all(
        winnerOnlyTaskIds.map(async (taskId) => {
          winningAddressesByTask.set(taskId, await winningAddressesForTask(ctx.db, taskId));
        })
      );

      // Phase 3 (ADR-0030): batch-fetch allowlist/award context for just the private
      // tasks in this result set -- zero extra queries when none of them are private.
      const privateTaskIds = Array.from(
        new Set(results.filter((row) => row.taskVisibility === 'private').map((row) => row.taskId))
      );
      const viewabilityByTaskId = await fetchPrivateViewabilityContextForTasks(
        ctx.db,
        privateTaskIds
      );

      const visible = results.filter((row) =>
        canViewSubmission({
          mode: row.submissionVisibility as SubmissionVisibilityMode,
          taskStatus: row.taskStatus,
          taskVerdictType: row.taskVerdictType,
          caller: ctx.caller,
          task: {
            id: row.taskId,
            requester: row.taskRequester,
            claimedBy: row.taskClaimedBy,
            evaluator: row.taskEvaluator,
            disputeResolver: row.taskDisputeResolver,
            taskVisibility: row.taskVisibility,
          },
          submission: { workerAddress: row.workerAddress },
          winningAddresses: winningAddressesByTask.get(row.taskId) ?? new Set<string>(),
          taskViewability: {
            taskAccessGrant: ctx.taskAccessGrant,
            ...viewabilityByTaskId.get(row.taskId),
          },
        })
      );

      return visible.map((row) => ({
        taskId: row.taskId,
        taskDescription: row.taskDescription,
        taskStatus: row.taskStatus,
        taskMode: row.taskMode,
        taskReward: row.taskReward,
        submittedAt: row.submittedAt.toISOString(),
        deliverableHash: row.deliverableHash ?? null,
        submitTxHash: row.submitTxHash ?? null,
        rejectedAt: row.rejectedAt?.toISOString() ?? null,
      }));
    }),

  download: optionalAuthProcedure
    .input(
      z.object({
        submissionId: z.string(),
        acceptanceTxHash: z.string(),
        artifactId: z.string().optional(),
      })
    )
    .output(z.object({ presignedUrl: z.string() }))
    .query(async ({ input, ctx }) => {
      const result = await ctx.db
        .select()
        .from(submissions)
        .where(eq(submissions.id, input.submissionId))
        .limit(1);

      if (result.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Submission not found' });
      }

      const submission = result[0];

      const taskResult = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, submission.taskId))
        .limit(1);

      if (taskResult.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }

      const task = taskResult[0];
      if (task.status !== 'completed') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Task not completed' });
      }

      await assertSubmissionVisible(
        ctx.db,
        task.id,
        task,
        submission,
        ctx.caller,
        ctx.taskAccessGrant,
        'Not authorized to download this submission'
      );

      let storageUri = submission.fileUrl;
      if (input.artifactId) {
        const artifactResult = await ctx.db
          .select()
          .from(artifacts)
          .where(eq(artifacts.id, input.artifactId))
          .limit(1);
        if (!artifactResult.length) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Artifact not found' });
        }
        const artifact = artifactResult[0];
        if (artifact.taskId !== submission.taskId || artifact.submissionId !== submission.id) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Task/submission/artifact mismatch' });
        }
        storageUri = artifact.storageUri;
      } else {
        const artifactResults = await ctx.db
          .select()
          .from(artifacts)
          .where(eq(artifacts.submissionId, input.submissionId));
        if (artifactResults.length === 1) {
          storageUri = artifactResults[0]!.storageUri;
        } else if (artifactResults.length > 1) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: '--artifact is required for this submission',
          });
        }
      }

      const storage = getStorageBackend();
      const presignedUrl = await storage.getPresignedUrl(storageUri, 3600);

      return { presignedUrl };
    }),
});

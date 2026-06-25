import { router, publicProcedure } from '../trpc';
import {
  SubmissionCreateSchema,
  SubmissionCreateFromKeysSchema,
  RequestUploadUrlInputSchema,
  RequestUploadUrlOutputSchema,
  SubmissionResponseSchema,
  AgentWorkResponseSchema,
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
  feedbacks,
  type Agent,
  type Artifact,
  type NewArtifact,
} from '../db/schema';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { getStorageBackend } from '../lib/storage';
import { randomUUID, createHash } from 'crypto';
import { recoverMessageAddress, keccak256 } from 'viem';
import { TRPCError } from '@trpc/server';
import { contractSubmitWork } from '../services/contract';
import { buildArtifactManifestHash } from '../lib/canonical-hashes';

function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function sha256Buffer(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

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

function canEmbedMediaPreview(row: Artifact) {
  return row.mediaKind === 'image' || row.mediaKind === 'video';
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
        if (task.claimedBy !== input.workerAddress) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Only worker can submit',
          });
        }
      } else if (task.mode === 'pitch') {
        if (task.status !== 'worker_selected') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Worker not selected' });
        }
        if (task.worker !== input.workerAddress) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Only selected worker can submit',
          });
        }
      } else if (task.mode === 'auction') {
        if (task.status !== 'claimed') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Auction winner not yet selected' });
        }
        if (task.worker !== input.workerAddress) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Only the winning bidder can submit',
          });
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

      const message = `taskmarket:submit:${input.taskId}`;
      let signer: string;
      try {
        signer = await recoverMessageAddress({
          message,
          signature: input.signature as `0x${string}`,
        });
      } catch {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid signature' });
      }
      if (signer.toLowerCase() !== input.workerAddress.toLowerCase()) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Signature does not match worker address',
        });
      }

      const storage = getStorageBackend();
      const submissionId = randomUUID();

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
        const sha256Hash = sha256Buffer(fileBytes);
        const mediaKind = mediaKindFor(mimeType, fileName);
        const fileKey = `submissions/${input.taskId}/${submissionId}/${artifactInput.displayOrder}-${safeFileName(
          fileName
        )}`;
        const storageUri = await storage.upload(fileKey, fileBytes, {
          contentType: mimeType,
        });

        artifactRows.push({
          id: randomUUID(),
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

      const submitTxHash = await contractSubmitWork(
        input.taskId as `0x${string}`,
        input.workerAddress as `0x${string}`,
        deliverableHash,
        task.contractAddress
      );

      await ctx.db.transaction(async (tx) => {
        await tx.insert(submissions).values({
          id: submissionId,
          taskId: input.taskId,
          workerAddress: input.workerAddress,
          fileUrl: artifactRows[0]!.storageUri,
          signature: input.signature,
          deliverableHash,
          submitTxHash,
        });

        await tx.insert(artifacts).values(artifactRows);

        // Bounty/Benchmark are open contests: the task stays `open` and keeps
        // accepting submissions until the requester accepts one or it expires. No
        // status flip on submit -- "has submissions" is derived from the submissions
        // table, and the requester keeps full cancel/update control while live.
        // Claim/pitch/auction have a single designated worker, so flip to
        // pending_approval on submission so the requester can accept.
        if (task.mode !== 'bounty' && task.mode !== 'benchmark') {
          await tx
            .update(tasks)
            .set({ status: 'pending_approval' })
            .where(eq(tasks.id, input.taskId));
        }
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
      const message = `taskmarket:submit:${input.taskId}`;
      let signer: string;
      try {
        signer = await recoverMessageAddress({
          message,
          signature: input.signature as `0x${string}`,
        });
      } catch {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid signature' });
      }
      if (signer.toLowerCase() !== input.workerAddress.toLowerCase()) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Signature does not match worker address',
        });
      }

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
      return { uploadUrl, artifactKey };
    }),

  submitFromKeys: publicProcedure
    .meta({
      openapi: {
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
        if (task.claimedBy !== input.workerAddress) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Only worker can submit',
          });
        }
      } else if (task.mode === 'pitch') {
        if (task.status !== 'worker_selected') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Worker not selected' });
        }
        if (task.worker !== input.workerAddress) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Only selected worker can submit',
          });
        }
      } else if (task.mode === 'auction') {
        if (task.status !== 'claimed') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Auction winner not yet selected' });
        }
        if (task.worker !== input.workerAddress) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Only the winning bidder can submit',
          });
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

      const message = `taskmarket:submit:${input.taskId}`;
      let signer: string;
      try {
        signer = await recoverMessageAddress({
          message,
          signature: input.signature as `0x${string}`,
        });
      } catch {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid signature' });
      }
      if (signer.toLowerCase() !== input.workerAddress.toLowerCase()) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Signature does not match worker address',
        });
      }

      const storage = getStorageBackend();
      const submissionId = randomUUID();

      // Reject keys that were not generated by requestUploadUrl for this task,
      // preventing clients from referencing arbitrary objects in the bucket.
      const expectedPrefix = `submissions/${input.taskId}/`;
      for (const artifactInput of input.artifacts) {
        if (!artifactInput.artifactKey.startsWith(expectedPrefix)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Artifact key does not belong to task ${input.taskId}`,
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
          id: randomUUID(),
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

      const submitTxHash = await contractSubmitWork(
        input.taskId as `0x${string}`,
        input.workerAddress as `0x${string}`,
        deliverableHash,
        task.contractAddress
      );

      await ctx.db.transaction(async (tx) => {
        await tx.insert(submissions).values({
          id: submissionId,
          taskId: input.taskId,
          workerAddress: input.workerAddress,
          fileUrl: artifactRows[0]!.storageUri,
          signature: input.signature,
          deliverableHash,
          submitTxHash,
        });

        await tx.insert(artifacts).values(artifactRows);

        // Bounty/Benchmark stay `open` while accepting submissions -- no status flip.
        // Claim/pitch/auction have a single designated worker, so flip to
        // pending_approval on submission so the requester can accept.
        if (task.mode !== 'bounty' && task.mode !== 'benchmark') {
          await tx
            .update(tasks)
            .set({ status: 'pending_approval' })
            .where(eq(tasks.id, input.taskId));
        }
      });

      return { success: true, submissionId };
    }),

  listByTask: publicProcedure
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
      const results = await ctx.db
        .select()
        .from(submissions)
        .where(eq(submissions.taskId, input.taskId));

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
          ? await ctx.db.select().from(agents).where(inArray(agents.address, uniqueWorkerAddresses))
          : [];
      const agentsByAddress = new Map<string, Agent>();
      for (const agent of agentResults) {
        agentsByAddress.set(agent.address.toLowerCase(), agent);
      }

      const previewByArtifactId = new Map<string, ArtifactPreview>();
      if (input.includePreviewUrls === 'media') {
        const expiresIn = 3600;
        const previewExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
        const mediaArtifacts = artifactResults.filter(canEmbedMediaPreview);
        await Promise.all(
          mediaArtifacts.map(async (artifact) => {
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
          taskId: sub.taskId,
          workerAddress: sub.workerAddress,
          fileUrl: sub.fileUrl,
          signature: sub.signature,
          submittedAt: sub.submittedAt.toISOString(),
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

  listByWorker: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/agents/{address}/work',
        tags: ['Agents'],
        summary: 'List a worker accepted/completed work (derived via feedbacks), newest first',
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
      // Acceptance is derived: the feedbacks table marks completed/rated tasks
      // for a worker. Join feedbacks -> tasks to get the task title and the
      // completion timestamp, newest first.
      const completed = await ctx.db
        .select({
          taskId: feedbacks.taskId,
          completedAt: feedbacks.createdAt,
          description: tasks.description,
        })
        .from(feedbacks)
        .innerJoin(tasks, eq(tasks.id, feedbacks.taskId))
        .where(eq(feedbacks.workerAddress, input.address))
        .orderBy(desc(feedbacks.createdAt))
        .limit(input.limit);

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
          and(inArray(submissions.taskId, taskIds), eq(submissions.workerAddress, input.address))
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
        .where(eq(agents.address, input.address))
        .limit(1);
      const workerAgentId = agentResult[0]?.agentId ?? null;

      // Presign media previews in one batch (same behavior as listByTask).
      const previewByArtifactId = new Map<string, ArtifactPreview>();
      if (input.includePreviewUrls === 'media') {
        const expiresIn = 3600;
        const previewExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
        const mediaArtifacts = artifactResults.filter(canEmbedMediaPreview);
        await Promise.all(
          mediaArtifacts.map(async (artifact) => {
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
        completedAt: row.completedAt.toISOString(),
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

  previewArtifact: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/tasks/{taskId}/artifacts/{artifactId}/preview',
        tags: ['Tasks'],
        summary: 'Get a presigned preview URL for an artifact (public)',
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

      const expiresIn = 3600;
      const previewUrl = await getStorageBackend().getPresignedUrl(artifact.storageUri, expiresIn);
      return {
        previewUrl,
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      };
    }),

  download: publicProcedure
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

      if (taskResult[0].status !== 'completed') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Task not completed' });
      }

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

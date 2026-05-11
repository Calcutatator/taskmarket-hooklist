import { router, publicProcedure } from '../trpc';
import {
  SubmissionCreateSchema,
  SubmissionResponseSchema,
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
  type Artifact,
  type NewArtifact,
} from '../db/schema';
import { eq, inArray } from 'drizzle-orm';
import { getStorageBackend } from '../lib/storage';
import { randomUUID, createHash } from 'crypto';
import { recoverMessageAddress, keccak256, toBytes } from 'viem';
import { TRPCError } from '@trpc/server';
import { contractSubmitWork } from '../services/contract';

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

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])])
    );
  }
  return value;
}

function buildArtifactManifestHash(
  artifactRows: Array<{
    role: ArtifactRoleValue;
    fileName: string;
    mimeType: string;
    mediaKind: ArtifactMediaKindValue;
    sizeBytes: number;
    sha256Hash: string;
    keccak256Hash: string;
    displayOrder: number;
  }>
): `0x${string}` {
  const manifest = sortKeys({
    version: 'taskmarket-artifacts-v1',
    artifacts: artifactRows
      .slice()
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((artifact) => ({
        role: artifact.role,
        fileName: artifact.fileName,
        mimeType: artifact.mimeType,
        mediaKind: artifact.mediaKind,
        sizeBytes: artifact.sizeBytes,
        sha256Hash: artifact.sha256Hash,
        keccak256Hash: artifact.keccak256Hash,
        displayOrder: artifact.displayOrder,
      })),
  });

  return keccak256(toBytes(JSON.stringify(manifest))) as `0x${string}`;
}

function toArtifactResponse(row: Artifact, workerAddress: string, workerAgentId: string | null) {
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
        throw new Error('Task not found');
      }

      const task = taskResult[0];

      if (task.mode === 'claim') {
        if (task.status !== 'claimed') {
          throw new Error('Task not claimed');
        }
        if (task.claimedBy !== input.workerAddress) {
          throw new Error('Only claimer can submit');
        }
      } else if (task.mode === 'pitch') {
        if (task.status !== 'worker_selected') {
          throw new Error('Worker not selected');
        }
        if (task.worker !== input.workerAddress) {
          throw new Error('Only selected worker can submit');
        }
      } else if (task.mode === 'auction') {
        if (task.status !== 'claimed') {
          throw new Error('Winner not selected yet');
        }
        if (task.worker !== input.workerAddress) {
          throw new Error('Only winning bidder can submit');
        }
      } else if (task.mode === 'bounty' || task.mode === 'benchmark') {
        if (task.status !== 'open' && task.status !== 'pending_approval') {
          throw new Error('Task not open for submissions');
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

        if (task.status === 'open') {
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
    .input(z.object({ taskId: z.string() }))
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

      const artifactsBySubmission = new Map<string, Artifact[]>();
      for (const artifact of artifactResults) {
        const existing = artifactsBySubmission.get(artifact.submissionId) ?? [];
        existing.push(artifact);
        artifactsBySubmission.set(artifact.submissionId, existing);
      }

      const submissionsWithStats = await Promise.all(
        results.map(async (sub) => {
          const agentResult = await ctx.db
            .select()
            .from(agents)
            .where(eq(agents.address, sub.workerAddress))
            .limit(1);

          const agent = agentResult[0];

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
              .map((row) => toArtifactResponse(row, sub.workerAddress, agent?.agentId ?? null)),
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
        })
      );

      return submissionsWithStats;
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

      if (!deviceResult.length) throw new Error('Invalid device credentials');
      const device = deviceResult[0];
      if (device.apiTokenHash !== sha256Hex(input.apiToken))
        throw new Error('Invalid device credentials');
      if (device.revokedAt !== null) throw new Error('Device has been revoked');

      const callerAddress = device.walletAddress.toLowerCase();

      // Look up submission
      const subResult = await ctx.db
        .select()
        .from(submissions)
        .where(eq(submissions.id, input.submissionId))
        .limit(1);

      if (!subResult.length) throw new Error('Submission not found');
      const sub = subResult[0];
      if (sub.taskId !== input.taskId) throw new Error('Task/submission mismatch');

      // Look up task
      const taskResult = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);

      if (!taskResult.length) throw new Error('Task not found');
      const task = taskResult[0];

      // Only the task requester or the submitting worker may preview
      if (
        callerAddress !== task.requester.toLowerCase() &&
        callerAddress !== sub.workerAddress.toLowerCase()
      ) {
        throw new Error('Not authorized to preview this submission');
      }

      let storageUri = sub.fileUrl;
      if (input.artifactId) {
        const artifactResult = await ctx.db
          .select()
          .from(artifacts)
          .where(eq(artifacts.id, input.artifactId))
          .limit(1);
        if (!artifactResult.length) throw new Error('Artifact not found');
        const artifact = artifactResult[0];
        if (artifact.taskId !== input.taskId || artifact.submissionId !== input.submissionId) {
          throw new Error('Task/submission/artifact mismatch');
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
          throw new Error('--artifact is required for this submission');
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

      if (!artifactResult.length) throw new Error('Artifact not found');
      const artifact = artifactResult[0];
      if (artifact.taskId !== input.taskId) throw new Error('Task/artifact mismatch');

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
        throw new Error('Submission not found');
      }

      const submission = result[0];

      const taskResult = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, submission.taskId))
        .limit(1);

      if (taskResult.length === 0 || taskResult[0].status !== 'accepted') {
        throw new Error('Task not accepted');
      }

      let storageUri = submission.fileUrl;
      if (input.artifactId) {
        const artifactResult = await ctx.db
          .select()
          .from(artifacts)
          .where(eq(artifacts.id, input.artifactId))
          .limit(1);
        if (!artifactResult.length) throw new Error('Artifact not found');
        const artifact = artifactResult[0];
        if (artifact.taskId !== submission.taskId || artifact.submissionId !== submission.id) {
          throw new Error('Task/submission/artifact mismatch');
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
          throw new Error('--artifact is required for this submission');
        }
      }

      const storage = getStorageBackend();
      const presignedUrl = await storage.getPresignedUrl(storageUri, 3600);

      return { presignedUrl };
    }),
});

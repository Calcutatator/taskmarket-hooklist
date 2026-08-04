'use client';

import { formatDreams, IDEMPOTENCY_KEY_HEADER } from '@taskmarket/shared';
import { CircleCheckIcon } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAccount, useSignMessage, useSignTypedData, useSwitchChain } from 'wagmi';
import { keccak256 } from 'viem';

import { DreamsRewardDisclosure } from '@/components/market/dreams-reward-disclosure';
import { InFlightWriteNotice } from '@/components/market/in-flight-write-notice';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { formatUsdcUnits } from '@/lib/format';
import { getLegalRequestHeaders } from '@/lib/legal-receipt';
import { isPendingTransactionMessage } from '@/lib/relayed-write-outcome';
import { useInFlightWrite } from '@/lib/use-in-flight-write';
import { payX402Post } from '@/lib/x402-client';

import { ConnectPrompt } from './connect-prompt';
import type { TaskActionComponentProps } from './types';

// Estimated worker DREAMS bonus reminder shown above the submit button. Only present
// when the DREAMS reward hook is attached and configured (estimatedWorkerDreamsBonus
// only exists on the detail response, not list rows). Same estimate caveats as
// tasks.tsx's dreamsBonusCaption -- pre-ramp, pre-cap, and bounty-mode settles at
// completion-time rates, not this one. See docs/reference/rewards.md.
function workerDreamsBonusReminder(task: TaskActionComponentProps['task']): string | null {
  const usdBonus =
    'estimatedWorkerUsdBonusValue' in task ? task.estimatedWorkerUsdBonusValue : undefined;
  const dreamsBonus =
    'estimatedWorkerDreamsBonus' in task ? task.estimatedWorkerDreamsBonus : undefined;
  if (!dreamsBonus || dreamsBonus === '0') {
    return null;
  }
  const estimate =
    usdBonus && usdBonus !== '0'
      ? `${formatUsdcUnits(usdBonus)} (~${formatDreams(dreamsBonus)} DREAMS)`
      : `${formatDreams(dreamsBonus)} DREAMS`;
  return `You may receive an estimated ${estimate} bonus after completing this task.`;
}

const ARTIFACT_ROLES = ['preview', 'source', 'final', 'attachment'] as const;
type ArtifactRole = (typeof ARTIFACT_ROLES)[number];

const MAX_FILES = 20;
const MAX_FILE_SIZE = 500 * 1024 * 1024;

type Staged = {
  id: string;
  file: File;
  role: ArtifactRole;
};

type UploadProgress = Record<string, number>;

function detectMimeType(file: File): string {
  return file.type || 'application/octet-stream';
}

function bytesToDisplay(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function computeHashes(
  buffer: ArrayBuffer
): Promise<{ sha256Hash: string; keccak256Hash: string }> {
  const sha256Bytes = await crypto.subtle.digest('SHA-256', buffer);
  const sha256Hash = Array.from(new Uint8Array(sha256Bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const keccak256Hash = keccak256(new Uint8Array(buffer)) as string;
  return { sha256Hash, keccak256Hash };
}

async function requestUploadUrl(
  apiUrl: string,
  params: {
    taskId: string;
    workerAddress: string;
    signature: string;
    fileName: string;
    mimeType: string;
    role: ArtifactRole;
    sizeBytes: number;
  }
): Promise<{ uploadUrl: string; artifactKey: string }> {
  const res = await fetch(`${apiUrl}/api/tasks/${params.taskId}/submissions/request-upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await getLegalRequestHeaders()) },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Failed to get upload URL (${res.status})`);
  }
  return res.json() as Promise<{ uploadUrl: string; artifactKey: string }>;
}

function uploadToS3(
  uploadUrl: string,
  file: File,
  onProgress: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', detectMimeType(file));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Upload network error'));
    xhr.send(file);
  });
}

export function SubmitArtifactsForm({ disabled, onSuccess, task }: TaskActionComponentProps) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [pending, setPending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inFlight = useInFlightWrite('Submission submitted, confirming');

  const addFiles = useCallback((files: FileList | File[]) => {
    setError(null);
    setStaged((current) => {
      const list = Array.from(files);
      const oversized = list.filter((f) => f.size > MAX_FILE_SIZE);
      const fitting = list.filter((f) => f.size <= MAX_FILE_SIZE);
      const remaining = MAX_FILES - current.length;
      const messages: string[] = [];
      if (oversized.length > 0) {
        messages.push(
          oversized.length === 1
            ? `File "${oversized[0].name}" exceeds 500 MB and was skipped.`
            : `${oversized.length} files exceed 500 MB and were skipped.`
        );
      }
      if (fitting.length > remaining) {
        messages.push(`At most ${MAX_FILES} files per submission - extra files were dropped.`);
      }
      if (messages.length > 0) setError(messages.join(' '));
      const accepted = fitting.slice(0, remaining).map((file, i) => ({
        id: `${Date.now()}-${i}-${file.name}`,
        file,
        role: 'attachment' as ArtifactRole,
      }));
      return [...current, ...accepted];
    });
  }, []);

  // Checked before every other branch, including the disconnected one: the files are uploaded
  // and the write is already out there, so this state must survive anything that would
  // otherwise swap the surface back to a staging form.
  if (inFlight.state) {
    return (
      <InFlightWriteNotice
        idempotencyKey={inFlight.state.idempotencyKey}
        stalled={inFlight.stalled}
        subject="submission"
        title="Submission submitted, confirming"
      />
    );
  }

  if (!isConnected || !address) {
    return <ConnectPrompt label="Connect a worker wallet to submit artifacts." />;
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files) addFiles(event.dataTransfer.files);
  }

  function setRole(id: string, role: ArtifactRole) {
    setStaged((current) => current.map((s) => (s.id === id ? { ...s, role } : s)));
  }

  function removeStaged(id: string) {
    setStaged((current) => current.filter((s) => s.id !== id));
  }

  async function handleSubmit() {
    if (staged.length === 0) {
      setError('Add at least one file before submitting');
      return;
    }
    setPending(true);
    setError(null);
    setUploadProgress({});

    const apiUrl = getBrowserApiBaseUrl();

    let signature: string;
    try {
      signature = await signMessageAsync({ message: `taskmarket:submit:${task.id}` });
    } catch (err) {
      setPending(false);
      const isRejected =
        typeof err === 'object' &&
        err !== null &&
        ((err as { code?: unknown }).code === 4001 ||
          (typeof (err as { message?: unknown }).message === 'string' &&
            ((err as { message: string }).message.toLowerCase().includes('user rejected') ||
              (err as { message: string }).message.toLowerCase().includes('user denied'))));
      if (isRejected) return;
      setError(err instanceof Error ? err.message : 'Signing failed');
      return;
    }

    try {
      // Upload all files in parallel, tracking per-file progress by staged id
      const artifactInputs = await Promise.all(
        staged.map(async (s) => {
          const mimeType = detectMimeType(s.file);

          const { uploadUrl, artifactKey } = await requestUploadUrl(apiUrl, {
            taskId: task.id,
            workerAddress: address!,
            signature,
            fileName: s.file.name,
            mimeType,
            role: s.role,
            sizeBytes: s.file.size,
          });

          const buffer = await s.file.arrayBuffer();
          const { sha256Hash, keccak256Hash } = await computeHashes(buffer);

          await uploadToS3(uploadUrl, s.file, (pct) => {
            setUploadProgress((prev) => ({ ...prev, [s.id]: pct }));
          });

          return {
            artifactKey,
            fileName: s.file.name,
            mimeType,
            role: s.role,
            sizeBytes: s.file.size,
            sha256Hash,
            keccak256Hash,
          };
        })
      );

      // /submissions/from-keys is gated by submissionAllowanceGate (RFC-0006): within the
      // free allowance it succeeds directly like before; past it, the backend responds 402
      // and payment is required. payX402Post assumes every call it probes is always paid, so
      // it can't be used for the first attempt here -- only fall back to it once actually
      // challenged with a 402, not before.
      const res = await fetch(`${apiUrl}/api/tasks/${task.id}/submissions/from-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await getLegalRequestHeaders()),
          [IDEMPOTENCY_KEY_HEADER]: inFlight.idempotencyKey,
        },
        body: JSON.stringify({
          taskId: task.id,
          workerAddress: address,
          artifacts: artifactInputs,
          signature,
        }),
      });

      if (res.status === 402) {
        const paid = await payX402Post(
          `/api/tasks/${task.id}/submissions/from-keys`,
          { taskId: task.id, workerAddress: address, artifacts: artifactInputs, signature },
          { address: address!, apiUrl, signTypedDataAsync, switchChainAsync },
          undefined,
          inFlight.idempotencyKey
        );
        if (!paid.ok) {
          if (paid.rejected) {
            setPending(false);
            return;
          }
          // Caught before the throw below: everything thrown here lands in the catch, which
          // sets an error and leaves the submit button live. An in-flight write must never
          // reach it -- past the free allowance this submission is paid, so pressing submit
          // again is a second payment.
          if (inFlight.capture(paid)) return;
          throw new Error(paid.error);
        }
      } else if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const message = body.error ?? `Submission failed (${res.status})`;
        // The unpaid path relays too, so it has the same in-flight outcome, read through the
        // same shared predicate rather than a second copy of the guess.
        if (
          inFlight.capture({
            ok: false,
            pending: isPendingTransactionMessage(message),
            idempotencyKey: inFlight.idempotencyKey,
            error: message,
          })
        ) {
          return;
        }
        throw new Error(message);
      }

      setDone(true);
      onSuccess?.();
      toast.success('Submission posted');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Submission failed';
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="grid gap-1 text-sm">
        <span className="flex items-center gap-1.5 font-mono text-primary">
          <CircleCheckIcon aria-hidden="true" className="size-4" />
          Submission posted
        </span>
        <p className="text-xs text-muted-foreground">
          The requester will review your deliverable and release the reward.
        </p>
      </div>
    );
  }

  const isUploading = pending && Object.keys(uploadProgress).length > 0;
  const bonusReminder = workerDreamsBonusReminder(task);

  return (
    <div className="grid gap-3">
      {bonusReminder ? (
        <div className="flex items-center gap-1">
          <p className="text-xs text-muted-foreground">{bonusReminder}</p>
          <DreamsRewardDisclosure />
        </div>
      ) : null}
      <div
        className={`rounded-md border border-dashed p-4 text-center transition-colors ${
          dragging ? 'border-primary bg-primary/5' : 'border-border/70 bg-surface/40'
        }`}
        onDragLeave={() => setDragging(false)}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDrop={handleDrop}
      >
        <p className="hidden text-sm text-muted-foreground sm:block">Drag files here or</p>
        <Button
          className="mt-2 w-full sm:w-auto"
          onClick={() => inputRef.current?.click()}
          size="sm"
          type="button"
          variant="outline"
        >
          Choose files
        </Button>
        <input
          className="sr-only"
          multiple
          onChange={(e) => {
            if (e.currentTarget.files) addFiles(e.currentTarget.files);
            e.currentTarget.value = '';
          }}
          ref={inputRef}
          type="file"
        />
        <p className="mt-2 text-xs text-muted-foreground">Up to {MAX_FILES} files, 500 MB each.</p>
      </div>

      {staged.length > 0 ? (
        <div className="grid gap-2">
          {staged.map((s) => (
            <div
              className="grid gap-1 rounded-md border border-border/60 bg-surface/40 px-3 py-2 text-sm"
              key={s.id}
            >
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs">{s.file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {bytesToDisplay(s.file.size)} - {detectMimeType(s.file)}
                  </p>
                </div>
                <Select onValueChange={(v) => setRole(s.id, v as ArtifactRole)} value={s.role}>
                  <SelectTrigger className="h-8 w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ARTIFACT_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  disabled={pending}
                  onClick={() => removeStaged(s.id)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Remove
                </Button>
              </div>
              {isUploading && uploadProgress[s.id] !== undefined ? (
                <div className="mt-1">
                  <div className="h-1 w-full overflow-hidden rounded-full bg-border/40">
                    <div
                      className="h-full bg-primary transition-all duration-100"
                      style={{ width: `${uploadProgress[s.id]}%` }}
                    />
                  </div>
                  <p className="mt-0.5 text-right text-xs text-muted-foreground">
                    {uploadProgress[s.id]}%
                  </p>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-1">
        <Label className="text-xs text-muted-foreground" htmlFor="submit-info">
          {staged.length} of {MAX_FILES} files staged
        </Label>
      </div>
      <Button
        disabled={disabled || pending || staged.length === 0}
        onClick={handleSubmit}
        size="sm"
      >
        {isUploading ? 'Uploading...' : pending ? 'Submitting...' : 'Submit work'}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
